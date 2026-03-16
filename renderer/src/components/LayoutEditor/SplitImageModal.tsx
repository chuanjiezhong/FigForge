import { useState, useRef, useEffect } from 'react'
import { Modal, Button, List, Slider } from 'antd'
import { ScissorOutlined, DeleteOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import styles from './SplitImageModal.module.less'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25

export interface Rect { x: number; y: number; w: number; h: number }

interface SplitImageModalProps {
  open: boolean
  imageDataUrl: string
  imageWidth: number
  imageHeight: number
  onConfirm: (regions: Rect[]) => void
  onCancel: () => void
}

export default function SplitImageModal({
  open,
  imageDataUrl,
  imageWidth,
  imageHeight,
  onConfirm,
  onCancel,
}: SplitImageModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [regions, setRegions] = useState<Rect[]>([])
  const [drawing, setDrawing] = useState(false)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null)

  // 用容器当前 getBoundingClientRect 将屏幕坐标转为图片像素坐标，不依赖图片 load
  const toImageCoords = (clientX: number, clientY: number): [number, number] | null => {
    if (!containerRef.current) return null
    const rect = containerRef.current.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    if (w <= 0 || h <= 0) return null
    const px = clientX - rect.left
    const py = clientY - rect.top
    return [
      (px / w) * imageWidth,
      (py / h) * imageHeight,
    ]
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const coords = toImageCoords(e.clientX, e.clientY)
    if (coords == null) return
    const [ix, iy] = coords
    if (ix >= 0 && ix <= imageWidth && iy >= 0 && iy <= imageHeight) {
      setDrawing(true)
      setStart({ x: ix, y: iy })
      setCurrent({ x: ix, y: iy })
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawing || !start) return
    const coords = toImageCoords(e.clientX, e.clientY)
    if (coords == null) return
    const [ix, iy] = coords
    setCurrent({ x: ix, y: iy })
  }

  const startRef = useRef<{ x: number; y: number } | null>(null)
  const currentRef = useRef<{ x: number; y: number } | null>(null)
  startRef.current = start
  currentRef.current = current

  const commitRegion = () => {
    const s = startRef.current
    const c = currentRef.current ?? s
    if (!s) return
    const x = Math.min(s.x, c.x)
    const y = Math.min(s.y, c.y)
    const w = Math.max(1, Math.abs(c.x - s.x))
    const h = Math.max(1, Math.abs(c.y - s.y))
    if (w >= 2 && h >= 2) setRegions((prev) => [...prev, { x, y, w, h }])
    setDrawing(false)
    setStart(null)
    setCurrent(null)
  }

  const handleMouseUp = () => {
    if (!drawing || !start) {
      setDrawing(false)
      setStart(null)
      setCurrent(null)
      return
    }
    commitRegion()
  }

  // 在容器外松开鼠标时也要结束框选
  useEffect(() => {
    if (!drawing) return
    const onWinMouseUp = () => {
      if (startRef.current) commitRegion()
    }
    window.addEventListener('mouseup', onWinMouseUp)
    return () => window.removeEventListener('mouseup', onWinMouseUp)
  }, [drawing])

  const removeRegion = (index: number) => {
    setRegions((prev) => prev.filter((_, i) => i !== index))
  }

  const handleConfirm = () => {
    if (regions.length === 0) return
    onConfirm(regions)
    setRegions([])
  }

  const handleClose = () => {
    setRegions([])
    setStart(null)
    setCurrent(null)
    onCancel()
  }

  // 当前绘制中的矩形（按图片像素转百分比用于 overlay）
  const overlayRect = start && current && imageWidth > 0 && imageHeight > 0
    ? {
        left: (Math.min(start.x, current.x) / imageWidth) * 100,
        top: (Math.min(start.y, current.y) / imageHeight) * 100,
        width: (Math.abs(current.x - start.x) / imageWidth) * 100,
        height: (Math.abs(current.y - start.y) / imageHeight) * 100,
      }
    : null

  return (
    <Modal
      title={
        <span>
          <ScissorOutlined /> 拆分图层：框选区域，每个区域将生成独立图层
        </span>
      }
      open={open}
      onCancel={handleClose}
      width={640}
      footer={[
        <Button key="cancel" onClick={handleClose}>取消</Button>,
        <Button key="ok" type="primary" onClick={handleConfirm} disabled={regions.length === 0}>
          确认拆分（{regions.length} 块）
        </Button>,
      ]}
      destroyOnClose
    >
      <div className={styles.splitModalBody}>
        <div className={styles.splitPreview}>
          <div className={styles.zoomToolbar}>
            <ZoomOutOutlined />
            <Slider
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={zoom}
              onChange={setZoom}
              className={styles.zoomSlider}
            />
            <ZoomInOutlined />
            <span className={styles.zoomPercent}>{Math.round(zoom * 100)}%</span>
          </div>
          <div className={styles.zoomViewport}>
            <div
              className={styles.zoomInner}
              style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}
            >
              <div
                ref={containerRef}
                className={styles.splitCanvasWrap}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <img
                  src={imageDataUrl}
                  alt="待拆分"
                  draggable={false}
                  style={{ maxWidth: '100%', maxHeight: 360, display: 'block', userSelect: 'none' }}
                />
                {/* 已框选区域半透明遮罩 */}
                {regions.map((r, i) => (
                  <div
                    key={i}
                    className={styles.regionOverlay}
                    style={{
                      left: `${(r.x / imageWidth) * 100}%`,
                      top: `${(r.y / imageHeight) * 100}%`,
                      width: `${(r.w / imageWidth) * 100}%`,
                      height: `${(r.h / imageHeight) * 100}%`,
                    }}
                  />
                ))}
                {overlayRect && (
                  <div
                    className={styles.regionOverlayDrawing}
                    style={{
                      left: `${overlayRect.left}%`,
                      top: `${overlayRect.top}%`,
                      width: `${overlayRect.width}%`,
                      height: `${overlayRect.height}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
          <p className={styles.splitHint}>可放大预览后框选，在图上按住鼠标拖动框选区域，可多次框选；确认后将新增多个图层，原图保留。</p>
        </div>
        <div className={styles.splitRegions}>
          <div className={styles.splitRegionsTitle}>已选区域（{regions.length}）</div>
          <List
            size="small"
            dataSource={regions}
            renderItem={(r, i) => (
              <List.Item
                actions={[
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeRegion(i)} />,
                ]}
              >
                区域 {i + 1}：({Math.round(r.x)}, {Math.round(r.y)}) {Math.round(r.w)}×{Math.round(r.h)}
              </List.Item>
            )}
          />
        </div>
      </div>
    </Modal>
  )
}
