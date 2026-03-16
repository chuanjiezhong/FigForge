import { useState, useEffect, useRef, useMemo } from 'react'
import { Modal, Space, ColorPicker, Button, Select, message } from 'antd'
import { BgColorsOutlined, DownloadOutlined } from '@ant-design/icons'
import styles from './index.module.less'

export type RecolorDownloadFormat = 'png' | 'pdf' | 'tiff'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '')
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  return [0, 0, 0]
}

function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function gradientAt(rgbs: [number, number, number][], t: number): [number, number, number] {
  if (rgbs.length === 1) return rgbs[0]
  if (rgbs.length === 2) return lerpRgb(rgbs[0], rgbs[1], t)
  if (t <= 0.5) return lerpRgb(rgbs[0], rgbs[1], t * 2)
  return lerpRgb(rgbs[1], rgbs[2], (t - 0.5) * 2)
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

function findT(pixel: [number, number, number], oldRgbs: [number, number, number][]): number {
  let bestT = 0
  let bestD = Infinity
  for (let t = 0; t <= 1; t += 0.02) {
    const c = gradientAt(oldRgbs, t)
    const d = dist(pixel, c)
    if (d < bestD) {
      bestD = d
      bestT = t
    }
  }
  return bestT
}

type Rgb3 = [number, number, number]

/** 在指定尺寸下渲染重配色图，返回 PNG data URL（用于导出高分辨率，避免 PDF 放大失真） */
function renderRecoloredAtSize(
  imageDataUrl: string,
  width: number,
  height: number,
  oldRgbs: Rgb3[],
  newRgbs: Rgb3[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法创建 canvas 2d 上下文'))
        return
      }
      const tmpCanvas = document.createElement('canvas')
      tmpCanvas.width = width
      tmpCanvas.height = height
      const tmpCtx = tmpCanvas.getContext('2d')
      if (!tmpCtx) {
        reject(new Error('无法创建临时 canvas'))
        return
      }
      tmpCtx.drawImage(img, 0, 0, width, height)
      const imageData = tmpCtx.getImageData(0, 0, width, height)
      const data = imageData.data
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]
        const t = findT([r, g, b], oldRgbs)
        const [nr, ng, nb] = gradientAt(newRgbs, t)
        data[i] = nr
        data[i + 1] = ng
        data[i + 2] = nb
        data[i + 3] = a
      }
      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = imageDataUrl
  })
}

const DEFAULT_OLD_GRADIENT = ['#0000FF', '#FFFFFF', '#FF0000']

function parseGradientStr(s: string): [number, number, number][] {
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5)
  return parts.map((hex) => hexToRgb(hex)) as [number, number, number][]
}

interface RecolorPreviewProps {
  open: boolean
  onClose: () => void
  imageDataUrl: string
  /** 原图使用的渐变（用于反推每个像素的 t 值），默认蓝-白-红，逗号分隔如 "blue,white,red" 或 "#0000FF,#FFFFFF,#FF0000" */
  defaultOldGradient?: string
}

export default function RecolorPreview({
  open,
  onClose,
  imageDataUrl,
  defaultOldGradient = DEFAULT_OLD_GRADIENT.join(','),
}: RecolorPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** 新渐变：你希望变成的三种颜色 */
  const [colors, setColors] = useState<string[]>(['#0000FF', '#FFFFFF', '#FF0000'])
  /** 原图渐变：生成该图时用的配色，用于反推每个像素在渐变上的位置；需与出图时一致 */
  const [oldGradientColors, setOldGradientColors] = useState<string[]>(() => {
    const parsed = defaultOldGradient.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3)
    const hexes = parsed.filter((p) => /^#[0-9A-Fa-f]{6}$/.test(p))
    return hexes.length >= 2 ? hexes : [...DEFAULT_OLD_GRADIENT]
  })
  const [loading, setLoading] = useState(false)
  const [downloadFormat, setDownloadFormat] = useState<RecolorDownloadFormat>('png')
  const [downloading, setDownloading] = useState(false)
  const oldRgbs = useMemo(
    () => (oldGradientColors.length >= 2 ? (oldGradientColors.slice(0, 3).map(hexToRgb) as [number, number, number][]) : (DEFAULT_OLD_GRADIENT.map(hexToRgb) as [number, number, number][])),
    [oldGradientColors]
  )

  useEffect(() => {
    if (!open || !imageDataUrl) return

    const runDraw = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      setLoading(true) // 确认 canvas 存在后再显示加载
      img.onload = () => {
        const canvasEl = canvasRef.current
        if (!canvasEl || !canvasEl.getContext('2d')) {
          setLoading(false)
          return
        }
        const ctx2 = canvasEl.getContext('2d')!
        const maxW = 800
        const maxH = 500
        let w = img.width
        let h = img.height
        if (w > maxW || h > maxH) {
          const scale = Math.min(maxW / w, maxH / h)
          w = Math.round(w * scale)
          h = Math.round(h * scale)
        }
        canvasEl.width = w
        canvasEl.height = h

        const newRgbs = colors.slice(0, 3).map(hexToRgb) as [number, number, number][]
        if (newRgbs.length < 2) newRgbs.push([255, 255, 255], [255, 0, 0])

        const tmpCanvas = document.createElement('canvas')
        tmpCanvas.width = w
        tmpCanvas.height = h
        const tmpCtx = tmpCanvas.getContext('2d')
        if (!tmpCtx) {
          setLoading(false)
          return
        }
        tmpCtx.drawImage(img, 0, 0, w, h)
        const imageData = tmpCtx.getImageData(0, 0, w, h)
        const data = imageData.data

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]
          const t = findT([r, g, b], oldRgbs)
          const [nr, ng, nb] = gradientAt(newRgbs, t)
          data[i] = nr
          data[i + 1] = ng
          data[i + 2] = nb
          data[i + 3] = a
        }
        ctx2.putImageData(imageData, 0, 0)
        setLoading(false)
      }
      img.onerror = () => setLoading(false)
      img.src = imageDataUrl
    }

    // Modal 打开时子内容可能尚未挂载，延迟一帧再绘制确保 canvas 已在 DOM 中
    const t = window.setTimeout(runDraw, 0)
    return () => clearTimeout(t)
  }, [open, imageDataUrl, colors, oldRgbs])

  const handleDownload = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ext = downloadFormat === 'pdf' ? 'pdf' : downloadFormat === 'tiff' ? 'tiff' : 'png'
    const defaultName = `recolored-${Date.now()}.${ext}`
    setDownloading(true)
    try {
      const savePath = await window.electronAPI.selectSavePath({
        defaultPath: defaultName,
        filters: [
          { name: downloadFormat === 'pdf' ? 'PDF 文件' : downloadFormat === 'tiff' ? 'TIFF 图片' : 'PNG 图片', extensions: [ext] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })
      if (!savePath) {
        setDownloading(false)
        return
      }

      // 用原图尺寸生成高分辨率图，避免 PDF/图片放大失真（预览画布被限制在 800x500）
      const newRgbs = colors.slice(0, 3).map(hexToRgb) as Rgb3[]
      if (newRgbs.length < 2) newRgbs.push([255, 255, 255], [255, 0, 0])
      let exportDataUrl: string
      let exportWidth: number
      let exportHeight: number
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      const origSize = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => reject(new Error('原图加载失败'))
        img.src = imageDataUrl
      })
      exportWidth = origSize.w
      exportHeight = origSize.h
      exportDataUrl = await renderRecoloredAtSize(imageDataUrl, exportWidth, exportHeight, oldRgbs, newRgbs)

      if (downloadFormat === 'pdf') {
        const result = await window.electronAPI.exportToPDF(
          { imageDataUrl: exportDataUrl },
          {
            outputPath: savePath,
            width: exportWidth,
            height: exportHeight,
            dpi: 300,
            template: 'custom',
          }
        )
        if (result?.success) {
          message.success('已保存为 PDF（原图分辨率，放大不失真）')
        } else {
          message.error(result?.error || 'PDF 保存失败')
        }
      } else {
        const result = await window.electronAPI.exportToImage(
          { imageDataUrl: exportDataUrl },
          { outputPath: savePath, format: downloadFormat, dpi: 300 }
        )
        if (result?.success) {
          message.success(`已保存为 ${downloadFormat.toUpperCase()}`)
        } else {
          message.error(result?.error || '保存失败')
        }
      }
    } catch (e) {
      message.error('保存失败')
      console.error(e)
    } finally {
      setDownloading(false)
    }
  }

  const list = [...colors]
  while (list.length < 3) list.push('#cccccc')
  const oldList = [...oldGradientColors]
  while (oldList.length < 3) oldList.push('#cccccc')

  return (
    <Modal
      title={
        <Space>
          <BgColorsOutlined />
          调整配色（实时预览）
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={900}
      footer={
        <Space>
          <Select
            value={downloadFormat}
            onChange={setDownloadFormat}
            options={[
              { label: 'PNG 图片', value: 'png' },
              { label: 'PDF 文档', value: 'pdf' },
              { label: 'TIFF 图片', value: 'tiff' },
            ]}
            style={{ width: 140 }}
          />
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload} loading={downloading}>
            下载当前预览
          </Button>
        </Space>
      }
      destroyOnClose
    >
      <div className={styles.recolorPanel}>
        <div className={styles.recolorToolbar}>
          <span className={styles.recolorLabel}>原图渐变：</span>
          <span className={styles.recolorHintInline}>（与生成该图时使用的配色一致，用于正确映射）</span>
          {oldList.slice(0, 3).map((hex, i) => (
            <Space key={`old-${i}`} align="center">
              <span className={styles.recolorLabel}>原色{i + 1}</span>
              <ColorPicker
                value={hex}
                onChange={(color) => {
                  const hexStr = color?.toHexString?.() ?? hex
                  const next = [...oldList]
                  next[i] = hexStr
                  setOldGradientColors(next)
                }}
                showText
                size="middle"
              />
            </Space>
          ))}
        </div>
        <div className={styles.recolorToolbar}>
          <span className={styles.recolorLabel}>新渐变：</span>
          {list.slice(0, 3).map((hex, i) => (
            <Space key={i} align="center">
              <span className={styles.recolorLabel}>色{i + 1}</span>
              <ColorPicker
                value={hex}
                onChange={(color) => {
                  const hexStr = color?.toHexString?.() ?? hex
                  const next = [...list]
                  next[i] = hexStr
                  setColors(next)
                }}
                showText
                size="middle"
              />
            </Space>
          ))}
        </div>
        <div className={styles.recolorPreview}>
          {loading && <div className={styles.recolorLoading}>生成预览中...</div>}
          <canvas ref={canvasRef} style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
        </div>
        <p className={styles.recolorHint}>
          <strong>逻辑：</strong>对每个像素，先根据「原图渐变」反推它在渐变上的位置 t（0→1），再用同一位置 t 在「新渐变」上取色替换。因此原图渐变需与出图时一致（默认蓝-白-红）。拖动色块可改原图/新渐变，下方预览即时更新；满意后可点击「下载当前预览」保存。
        </p>
      </div>
    </Modal>
  )
}
