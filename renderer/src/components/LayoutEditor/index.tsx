import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import * as fabricModule from 'fabric'
import styles from './index.module.less'
import type { fabric as FabricType } from 'fabric'
import { message, Button, ColorPicker, Checkbox, InputNumber, Radio, Select, Input, Space, Tag, Tooltip, Image, Modal, Tour, Switch, Slider } from 'antd'
import { FullscreenOutlined, FullscreenExitOutlined, BgColorsOutlined, FontSizeOutlined, PictureOutlined, ArrowUpOutlined, ArrowDownOutlined, ScissorOutlined, CopyOutlined, DeleteOutlined, FolderOpenOutlined, LeftOutlined, RightOutlined, ReloadOutlined, SnippetsOutlined, QuestionCircleOutlined, BulbOutlined } from '@ant-design/icons'
import { recolorImage, DEFAULT_OLD_GRADIENT, type RecolorMode } from '../../utils/recolorImage'
import { pdfFirstPageToDataUrl } from '../../utils/pdfToDataUrl'
import SplitImageModal, { type Rect } from './SplitImageModal'

// fabric.js v5 使用 CommonJS 导出，需要访问 .fabric 属性
// @ts-expect-error - fabric.js CommonJS 导出结构
const fabric: typeof FabricType = (fabricModule as { fabric?: typeof FabricType }).fabric || fabricModule

/** 重绘注释列内置可选颜色（生信常用/色盲友好，与 FunctionDetail 一致；未指定时也作为默认值传给 R） */
const REDRAW_ANNOTATION_PRESET_COLORS = [
  '#0072B2', '#D55E00', '#009E73', '#F0E442', '#56B4E9', '#E69F00', '#CC79A7', '#000000', '#999999',
]
const REDRAW_ANNOTATION_CHIP_SIZE = 36

type RedrawParameterDef = {
  name: string
  type?: string
  required?: boolean
  default?: unknown
  options?: string[]
  placeholder?: string
  min?: number
  max?: number
}

type ActiveTool = 'select' | 'recolor' | 'redraw' | 'text' | 'split'
const CANVAS_TOUR_SEEN_KEY = 'figforge.tour.canvas.v1'
const ALIGN_ASSIST_STORAGE_KEY = 'figforge.canvas.alignAssist.v1'
const GRID_SNAP_ENABLED_STORAGE_KEY = 'figforge.canvas.gridSnapEnabled.v1'
const GRID_SNAP_SIZE_STORAGE_KEY = 'figforge.canvas.gridSnapSize.v1'
const TEXT_FONT_OPTIONS = [
  { label: '无衬线', value: 'sans-serif' },
  { label: '衬线', value: 'serif' },
  { label: '等宽', value: 'monospace' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'PingFang SC', value: 'PingFang SC' },
]
const FONT_SCAN_CANDIDATES = [
  'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'STHeiti', 'Songti SC', 'Kaiti SC',
  'Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'NSimSun', 'DengXian',
  'Segoe UI', 'Arial', 'Arial Unicode MS', 'Tahoma', 'Verdana', 'Times New Roman', 'Georgia', 'Courier New',
  'Noto Sans', 'Noto Serif', 'Noto Sans CJK SC', 'Noto Serif CJK SC',
  'Source Han Sans SC', 'Source Han Serif SC',
  'Ubuntu', 'Cantarell', 'DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Serif',
  'sans-serif', 'serif', 'monospace',
]

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)))
}

function detectFontsByCanvas(fonts: string[]): string[] {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return []
  const sample = 'mmmmmmmmmmlli00WQ生信热图ABCxyz123'
  const bases = ['monospace', 'sans-serif', 'serif'] as const
  const baseWidth: Record<string, number> = {}
  for (const base of bases) {
    ctx.font = `72px ${base}`
    baseWidth[base] = ctx.measureText(sample).width
  }
  const available: string[] = []
  for (const font of fonts) {
    let detected = false
    for (const base of bases) {
      ctx.font = `72px "${font}", ${base}`
      const w = ctx.measureText(sample).width
      if (Math.abs(w - baseWidth[base]) > 0.1) {
        detected = true
        break
      }
    }
    if (detected) available.push(font)
  }
  return dedupeStrings(available)
}

async function detectSystemFonts(): Promise<string[]> {
  const win = window as unknown as {
    queryLocalFonts?: () => Promise<Array<{ family?: string; fullName?: string }>>
  }
  if (typeof win.queryLocalFonts === 'function') {
    try {
      const list = await win.queryLocalFonts()
      const families = dedupeStrings(list.map((f) => f.family || f.fullName || ''))
      if (families.length > 0) return families
    } catch {
      // fallback
    }
  }
  return detectFontsByCanvas(FONT_SCAN_CANDIDATES)
}

function toHexColor(input: unknown): string {
  if (typeof input !== 'string') return ''
  const s = input.trim()
  if (!s) return ''
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toUpperCase()
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    const h = s.slice(1)
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase()
  }
  // 尝试用浏览器颜色解析（支持 blue/white/red 等命名色）
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#000000'
  try {
    ctx.fillStyle = s
  } catch {
    return ''
  }
  const normalized = String(ctx.fillStyle)
  if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) return normalized.toUpperCase()
  const m = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!m) return ''
  const toHex = (v: string) => Number(v).toString(16).padStart(2, '0').toUpperCase()
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`
}

function parseAnnotationColors(sourceParams: Record<string, unknown>): {
  control: string
  disease: string
  datasetMap: Record<string, string>
} {
  let control = toHexColor(sourceParams.annotation_control)
  let disease = toHexColor(sourceParams.annotation_disease)
  let datasetMap: Record<string, string> = {}

  if (sourceParams.annotation_dataset && typeof sourceParams.annotation_dataset === 'object' && !Array.isArray(sourceParams.annotation_dataset)) {
    const rec = sourceParams.annotation_dataset as Record<string, unknown>
    datasetMap = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, toHexColor(v)]).filter(([, v]) => Boolean(v)))
  }

  const ann = (sourceParams as { annotation_colors_list?: unknown }).annotation_colors_list
  if (ann && typeof ann === 'object' && !Array.isArray(ann)) {
    const obj = ann as Record<string, unknown>
    const group = (obj.group as Record<string, unknown> | undefined) || (obj.Group as Record<string, unknown> | undefined)
    const ds = (obj.dataset as Record<string, unknown> | undefined) || (obj.DataSet as Record<string, unknown> | undefined)
    if (!control) control = toHexColor(group?.Control)
    if (!disease) disease = toHexColor(group?.Disease)
    if (ds && Object.keys(datasetMap).length === 0) {
      datasetMap = Object.fromEntries(Object.entries(ds).map(([k, v]) => [k, toHexColor(v)]).filter(([, v]) => Boolean(v)))
    }
  } else if (typeof ann === 'string') {
    const c1 = ann.match(/"Control"\s*=\s*"([^"]+)"/i)?.[1]
    const c2 = ann.match(/"Disease"\s*=\s*"([^"]+)"/i)?.[1]
    if (!control) control = toHexColor(c1)
    if (!disease) disease = toHexColor(c2)
    const dsPart = ann.match(/DataSet\s*=\s*c\(([\s\S]*?)\)/i)?.[1]
    if (dsPart && Object.keys(datasetMap).length === 0) {
      const re = /"([^"]+)"\s*=\s*"([^"]+)"/g
      let m: RegExpExecArray | null = null
      const next: Record<string, string> = {}
      while ((m = re.exec(dsPart))) {
        const hex = toHexColor(m[2])
        if (hex) next[m[1]] = hex
      }
      datasetMap = next
    }
  }

  return { control, disease, datasetMap }
}

// 在指定图片 dataURL 的某个归一化区域内，估计主色（排除接近白色），返回 hex；失败时返回 null
async function detectDominantColorInRegion(
  imageDataUrl: string,
  region: { x: number; y: number; w: number; h: number }
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width
        const height = img.naturalHeight || img.height
        if (!width || !height) {
          resolve(null)
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        const rx = Math.max(0, Math.min(1, region.x))
        const ry = Math.max(0, Math.min(1, region.y))
        const rw = Math.max(0, Math.min(1 - rx, region.w))
        const rh = Math.max(0, Math.min(1 - ry, region.h))
        const x0 = Math.floor(rx * width)
        const y0 = Math.floor(ry * height)
        const w = Math.max(1, Math.floor(rw * width))
        const h = Math.max(1, Math.floor(rh * height))
        const imageData = ctx.getImageData(x0, y0, w, h)
        const data = imageData.data
        const buckets = new Map<string, { r: number; g: number; b: number; count: number }>()
        const step = 8
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const brightness = (r + g + b) / 3
          if (brightness > 245) continue // 近似白色视为背景
          const qr = Math.max(0, Math.min(255, Math.round(r / step) * step))
          const qg = Math.max(0, Math.min(255, Math.round(g / step) * step))
          const qb = Math.max(0, Math.min(255, Math.round(b / step) * step))
          const key = `${qr},${qg},${qb}`
          const existed = buckets.get(key)
          if (existed) {
            existed.count += 1
          } else {
            buckets.set(key, { r: qr, g: qg, b: qb, count: 1 })
          }
        }
        let best: { r: number; g: number; b: number; count: number } | null = null
        for (const b of buckets.values()) {
          if (!best || b.count > best.count) best = b
        }
        if (!best) {
          resolve(null)
          return
        }
        const toHex = (v: number) => v.toString(16).padStart(2, '0')
        resolve(`#${toHex(best.r)}${toHex(best.g)}${toHex(best.b)}`)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = imageDataUrl
  })
}

// 将“边缘连通的近白色背景”转为透明，尽量保留内部白色内容
async function stripBorderWhiteToTransparent(
  imageDataUrl: string,
  threshold = 245,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width
        const height = img.naturalHeight || img.height
        if (!width || !height) {
          resolve(imageDataUrl)
          return
        }
        const c = document.createElement('canvas')
        c.width = width
        c.height = height
        const ctx = c.getContext('2d')
        if (!ctx) {
          resolve(imageDataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        const imageData = ctx.getImageData(0, 0, width, height)
        const data = imageData.data
        const total = width * height
        const visited = new Uint8Array(total)
        const queue: number[] = []
        const isNearWhite = (idx: number) => {
          const base = idx * 4
          const a = data[base + 3]
          if (a === 0) return false
          return data[base] >= threshold && data[base + 1] >= threshold && data[base + 2] >= threshold
        }
        const push = (idx: number) => {
          if (idx < 0 || idx >= total) return
          if (visited[idx]) return
          if (!isNearWhite(idx)) return
          visited[idx] = 1
          queue.push(idx)
        }

        for (let x = 0; x < width; x += 1) {
          push(x) // top
          push((height - 1) * width + x) // bottom
        }
        for (let y = 1; y < height - 1; y += 1) {
          push(y * width) // left
          push(y * width + (width - 1)) // right
        }

        while (queue.length > 0) {
          const cur = queue.shift() as number
          const x = cur % width
          const y = Math.floor(cur / width)
          if (x > 0) push(cur - 1)
          if (x < width - 1) push(cur + 1)
          if (y > 0) push(cur - width)
          if (y < height - 1) push(cur + width)
        }

        let changed = 0
        for (let i = 0; i < total; i += 1) {
          if (!visited[i]) continue
          const base = i * 4
          if (data[base + 3] !== 0) {
            data[base + 3] = 0
            changed += 1
          }
        }
        if (changed === 0) {
          resolve(imageDataUrl)
          return
        }
        ctx.putImageData(imageData, 0, 0)
        resolve(c.toDataURL('image/png'))
      } catch {
        resolve(imageDataUrl)
      }
    }
    img.onerror = () => resolve(imageDataUrl)
    img.src = imageDataUrl
  })
}

function LayoutEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasWrapperRef = useRef<HTMLDivElement>(null)
  const fabricCanvasRef = useRef<FabricType.Canvas | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  /** 选中可填色的图片时展示填色面板 */
  const [selectedImageData, setSelectedImageData] = useState<{
    obj: FabricType.Object
    originalDataUrl: string
  } | null>(null)
  const [recolorOldColors, setRecolorOldColors] = useState<string[]>(() => [...DEFAULT_OLD_GRADIENT])
  const [recolorNewColors, setRecolorNewColors] = useState<string[]>(() => ['#0000FF', '#FFFFFF', '#FF0000'])
  const [recolorMode, setRecolorMode] = useState<RecolorMode>('gradient')
  const [recolorOnlyNearGradient, setRecolorOnlyNearGradient] = useState(true)
  const [recolorApplying, setRecolorApplying] = useState(false)
  const [recolorInlineError, setRecolorInlineError] = useState('')
  /** 填色的局部选区（相对于图片尺寸的 0~1 坐标）；为 null 时表示整图 */
  const [recolorRegion, setRecolorRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  /** 画布上用于展示选区的矩形 */
  const recolorRegionRectRef = useRef<FabricType.Rect | null>(null)
  /** 正在框选标记 & 起点（图片局部坐标） */
  const recolorRegionStartRef = useRef<{ x: number; y: number } | null>(null)
  /** 框选期间临时关闭图片拖动，结束后还原 */
  const recolorRegionPrevStateRef = useRef<{ selectable: boolean; evented: boolean } | null>(null)
  /** 是否处于框选模式，用于避免 selection:cleared 时把 selectedImageData 一起清掉 */
  const recolorSelectingRef = useRef(false)
  /** 选中文本图层时的字号、颜色（与画布上对象同步） */
  const [textFontSize, setTextFontSize] = useState(24)
  const [textFill, setTextFill] = useState('#000000')
  const [textBatchStep, setTextBatchStep] = useState(2)
  const [textFontFamily, setTextFontFamily] = useState('sans-serif')
  const [textFontWeight, setTextFontWeight] = useState<'normal' | 'bold'>('normal')
  const [textFontStyle, setTextFontStyle] = useState<'normal' | 'italic'>('normal')
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left')
  const [textUnderline, setTextUnderline] = useState(false)
  const [textLinethrough, setTextLinethrough] = useState(false)
  const [textOverline, setTextOverline] = useState(false)
  const [textLineHeight, setTextLineHeight] = useState(1.2)
  const [textCharSpacing, setTextCharSpacing] = useState(0)
  const [availableFonts, setAvailableFonts] = useState<string[]>(() => dedupeStrings(TEXT_FONT_OPTIONS.map((f) => f.value)))
  const [fontLoading, setFontLoading] = useState(false)
  const [textApplyFields, setTextApplyFields] = useState<Array<
    'fontSize' | 'fill' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'textAlign' | 'underline' | 'linethrough' | 'overline' | 'lineHeight' | 'charSpacing'
  >>([
    'fontSize', 'fill', 'fontFamily', 'fontWeight', 'fontStyle', 'textAlign', 'underline', 'linethrough', 'overline', 'lineHeight', 'charSpacing',
  ])
  /** 画布上的所有对象（用于图层面板），从下到上顺序即 canvas 的 objects 顺序 */
  const [layers, setLayers] = useState<FabricType.Object[]>([])
  /** 当前选中的对象（任意类型），用于图层面板高亮 */
  const [selectedObject, setSelectedObject] = useState<FabricType.Object | null>(null)
  /** 拆分图层弹窗：当前要拆分的图片信息 */
  const [splitPayload, setSplitPayload] = useState<{
    dataUrl: string
    imgWidth: number
    imgHeight: number
    left: number
    top: number
    scaleX: number
    scaleY: number
    obj: FabricType.Object
  } | null>(null)
  /** 复制图层时暂存的 toObject() 结果，用于粘贴 */
  const copiedObjectJsonRef = useRef<Record<string, unknown> | null>(null)
  const draggingLayerRef = useRef<FabricType.Object | null>(null)
  /** 是否有可粘贴内容（用于粘贴按钮可用状态，复制后设为 true） */
  const [hasCopied, setHasCopied] = useState(false)
  /** 从 RDS 重绘：当前选中图是否支持重绘及对应的重绘函数名（由 function-docs 的 redrawFunction 决定；来自运行结果时强绑定） */
  const [redrawConfig, setRedrawConfig] = useState<{ redrawFunctionName: string; packageName: string; redrawParameters?: RedrawParameterDef[] } | null>(null)
  /** 所有支持重绘的方法（用于本地上传图时让用户选择「哪个方法」） */
  const [redrawMethodOptions, setRedrawMethodOptions] = useState<Array<{ key: string; sourceName: string; redrawFunctionName: string; packageName: string; redrawParameters?: RedrawParameterDef[] }>>([])
  /** 本地上传图时用户选择的重绘方法 key、RDS 目录、RDS 文件名 */
  const [selectedManualRedrawKey, setSelectedManualRedrawKey] = useState<string>('')
  const [manualOutputDir, setManualOutputDir] = useState<string>('')
  const [manualRdsFile, setManualRdsFile] = useState<string>('heatmap.rds')
  const [redrawPreviewDataUrl, setRedrawPreviewDataUrl] = useState<string | null>(null)
  const [redrawCompareOpen, setRedrawCompareOpen] = useState(false)
  const [redrawCompareMode, setRedrawCompareMode] = useState<'sideBySide' | 'slider'>('sideBySide')
  const [redrawCompareSwap, setRedrawCompareSwap] = useState(false)
  const [redrawComparePos, setRedrawComparePos] = useState(50)
  const [redrawAssembledCall, setRedrawAssembledCall] = useState<string>('')
  const [redrawLoading, setRedrawLoading] = useState(false)
  const [redrawFontSize, setRedrawFontSize] = useState(12)
  /** 重绘专用：palette（低/中/高）、注释颜色（与 R 参数一致）、宽高（英寸） */
  const [redrawPalette, setRedrawPalette] = useState<string[]>(['#0000FF', '#FFFFFF', '#FF0000'])
  const [redrawAnnotationGroupControl, setRedrawAnnotationGroupControl] = useState<string>(REDRAW_ANNOTATION_PRESET_COLORS[0])
  const [redrawAnnotationGroupDisease, setRedrawAnnotationGroupDisease] = useState<string>(REDRAW_ANNOTATION_PRESET_COLORS[1])
  /** DataSet 按样本名称对应颜色（与 Group 类似）；样本名以标签形式添加，每个样本一行颜色 */
  const [redrawDatasetNamesList, setRedrawDatasetNamesList] = useState<string[]>([])
  const [redrawAnnotationDataset, setRedrawAnnotationDataset] = useState<Record<string, string>>({})
  const [redrawWidth, setRedrawWidth] = useState<number | undefined>(8)
  const [redrawHeight, setRedrawHeight] = useState<number | undefined>(10)
  const [redrawShowGeneNames, setRedrawShowGeneNames] = useState(false)
  const [redrawImageFormat, setRedrawImageFormat] = useState<'png' | 'pdf'>('png')
  const [redrawDpi, setRedrawDpi] = useState<number>(150)
  const [redrawExtraParams, setRedrawExtraParams] = useState<Record<string, unknown>>({})
  const [bgStripEnabled, setBgStripEnabled] = useState(true)
  const [bgStripThreshold, setBgStripThreshold] = useState(246)
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const lastImageToolRef = useRef<'recolor' | 'redraw'>('recolor')
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const [canvasTourOpen, setCanvasTourOpen] = useState(false)
  const [canvasTourCurrent, setCanvasTourCurrent] = useState(0)
  const [alignAssistEnabled, setAlignAssistEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ALIGN_ASSIST_STORAGE_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [gridSnapEnabled, setGridSnapEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GRID_SNAP_ENABLED_STORAGE_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [gridSnapSize, setGridSnapSize] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem(GRID_SNAP_SIZE_STORAGE_KEY) || '10')
      return Number.isFinite(raw) ? Math.max(4, Math.min(100, Math.round(raw))) : 10
    } catch {
      return 10
    }
  })
  const alignAssistEnabledRef = useRef(alignAssistEnabled)
  const gridSnapEnabledRef = useRef(gridSnapEnabled)
  const gridSnapSizeRef = useRef(gridSnapSize)
  const contextRunRedrawRef = useRef<null | (() => void)>(null)
  const contextApplyRedrawRef = useRef<null | (() => void)>(null)
  const beginRecolorRegionSelectionRef = useRef<null | (() => void)>(null)
  const addTextLayerRef = useRef<null | (() => void)>(null)
  const openSplitModalRef = useRef<null | (() => void)>(null)
  /** 右侧填色/重绘面板宽度（展开后可拖拽调整） */
  const [recolorPanelWidth, setRecolorPanelWidth] = useState(300)
  const [recolorPanelCollapsed, setRecolorPanelCollapsed] = useState(false)
  const recolorPanelWidthRef = useRef(recolorPanelWidth)
  recolorPanelWidthRef.current = recolorPanelWidth
  const recolorResizeStartRef = useRef<{ x: number; w: number } | null>(null)
  const quickToolsTourRef = useRef<HTMLDivElement>(null)
  const layersTourRef = useRef<HTMLDivElement>(null)
  const panelTourRef = useRef<HTMLDivElement>(null)
  const canvasTourBtnRef = useRef<HTMLDivElement>(null)
  const alignGuideLinesRef = useRef<{ v: FabricType.Line | null; h: FabricType.Line | null }>({ v: null, h: null })
  const bgStripApplySeqRef = useRef(0)
  const bgStripCacheRef = useRef<Map<string, string>>(new Map())
  const recolorSelectionCleanupRef = useRef<null | (() => void)>(null)
  const recolorReenterTimerRef = useRef<number | null>(null)
  const activeToolRef = useRef<ActiveTool>('select')
  const addImageQueueRef = useRef<Array<{
    imagePath: string
    source?: { outputDir?: string; functionName?: string; packageName?: string; rdsFile?: string; sourceParams?: Record<string, unknown> }
    key: string
  }>>([])
  const addImageQueuedSetRef = useRef<Set<string>>(new Set())
  const addImageProcessingRef = useRef(false)
  const addImageCurrentPathRef = useRef<string | null>(null)

  const emitAddQueueStatus = useCallback(() => {
    const pending = addImageQueueRef.current.length
    const processing = addImageProcessingRef.current
    const currentImagePath = addImageCurrentPathRef.current
    const event = new CustomEvent('add-image-queue-status', {
      detail: { pending, processing, busy: processing || pending > 0, currentImagePath },
    })
    window.dispatchEvent(event)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(ALIGN_ASSIST_STORAGE_KEY, alignAssistEnabled ? '1' : '0')
    } catch {
      // ignore storage write failure
    }
    alignAssistEnabledRef.current = alignAssistEnabled
  }, [alignAssistEnabled])
  useEffect(() => {
    try {
      localStorage.setItem(GRID_SNAP_ENABLED_STORAGE_KEY, gridSnapEnabled ? '1' : '0')
    } catch {
      // ignore storage write failure
    }
    gridSnapEnabledRef.current = gridSnapEnabled
  }, [gridSnapEnabled])
  useEffect(() => {
    try {
      localStorage.setItem(GRID_SNAP_SIZE_STORAGE_KEY, String(gridSnapSize))
    } catch {
      // ignore storage write failure
    }
    gridSnapSizeRef.current = gridSnapSize
  }, [gridSnapSize])
  useEffect(() => {
    activeToolRef.current = activeTool
  }, [activeTool])

  const fontSelectOptions = useMemo(
    () => dedupeStrings([...availableFonts, textFontFamily]).map((name) => ({ label: name, value: name })),
    [availableFonts, textFontFamily],
  )

  const refreshSystemFonts = useCallback(async (notify = false) => {
    setFontLoading(true)
    try {
      const detected = await detectSystemFonts()
      const merged = dedupeStrings([...TEXT_FONT_OPTIONS.map((f) => f.value), ...detected])
      setAvailableFonts(merged)
      if (notify) message.success(`已加载本机字体：${merged.length} 个`)
    } catch {
      if (notify) message.warning('读取本机字体失败，已保留默认字体列表')
    } finally {
      setFontLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSystemFonts(false)
  }, [refreshSystemFonts])

  // 判断文件是否为 PDF
  const isPdfFile = (path: string): boolean => {
    const ext = path.split('.').pop()?.toLowerCase()
    return ext === 'pdf'
  }

  // 判断文件是否为 SVG
  const isSvgFile = (path: string): boolean => {
    const ext = path.split('.').pop()?.toLowerCase()
    return ext === 'svg'
  }

  /** 添加图片到画布；source 为从结果视图/运行记录传入的「强绑定」信息，用于 RDS 重绘与旧参数对比 */
  const addImageToCanvas = useCallback(async (
    imagePath: string,
    source?: { outputDir?: string; functionName?: string; packageName?: string; rdsFile?: string; sourceParams?: Record<string, unknown> }
  ) => {
    console.log('addImageToCanvas 被调用，图片路径:', imagePath, 'canvas 状态:', !!fabricCanvasRef.current)
    if (!fabricCanvasRef.current) {
      console.error('Canvas 未初始化，无法添加图片')
      message.error('画布尚未初始化，请稍候再试')
      return
    }

    const finalImagePath = imagePath
    /** PDF 在渲染进程用 PDF.js 转成第一页 PNG dataURL，直接给 Fabric 用，无需主进程转换 */
    let pdfPngDataUrl: string | null = null
    let pdfRawDataUrl: string | null = null

    if (isPdfFile(imagePath)) {
      try {
        const readRes = await window.electronAPI.readFile(imagePath)
        if (!readRes.success || !readRes.content || !readRes.content.startsWith('data:application/pdf')) {
          message.error(readRes.error || '读取 PDF 失败')
              return
            }
        // 传 ArrayBuffer 给 PDF.js，避免在 worker 里解析 data URL（worker 中无 URL.parse 会报错）
        const base64 = readRes.content.replace(/^data:application\/pdf;base64,/, '')
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const { dataUrl } = await pdfFirstPageToDataUrl(bytes.buffer, 2)
        pdfRawDataUrl = dataUrl
        pdfPngDataUrl = await stripBorderWhiteToTransparent(dataUrl, 246)
          } catch (error) {
        console.error('PDF 渲染失败:', error)
        const msg = error instanceof Error ? error.message : '未知错误'
        message.error(`PDF 渲染失败: ${msg.length > 80 ? msg.slice(0, 80) + '…' : msg}`)
        return
      }
    }

    // 检查是否为 SVG 文件（不包括 PDF 转的图）
    const isSvg = !pdfPngDataUrl && isSvgFile(finalImagePath)
    
    console.log('正在加载:', finalImagePath, '是否为 SVG:', isSvg, '是否 PDF 已转图:', !!pdfPngDataUrl)
    try {
      if (pdfPngDataUrl) {
        // PDF 第一页已在渲染进程转为 PNG dataURL，直接交给 Fabric
        await new Promise<void>((resolve) => {
          fabric.Image.fromURL(
            pdfPngDataUrl,
            (img) => {
              if (!fabricCanvasRef.current) {
                resolve()
                return
              }
              const canvas = fabricCanvasRef.current
              const canvasWidth = canvas.width || 1200
              const canvasHeight = canvas.height || 800
              const imgWidth = img.width || 0
              const imgHeight = img.height || 0
              const scale = Math.min((canvasWidth * 0.8) / imgWidth, (canvasHeight * 0.8) / imgHeight, 1)
              img.set({
                left: (canvasWidth - imgWidth * scale) / 2,
                top: (canvasHeight - imgHeight * scale) / 2,
                scaleX: scale,
                scaleY: scale,
                data: {
                  originalDataUrl: pdfPngDataUrl,
                  rawOriginalDataUrl: pdfRawDataUrl || pdfPngDataUrl,
                  bgStripEnabled: true,
                  bgStripThreshold: 246,
                  ...(source?.outputDir && {
                    outputDir: source.outputDir,
                    sourceFunctionName: source.functionName,
                    sourcePackageName: source.packageName,
                    rdsFile: source.rdsFile || 'heatmap.rds',
                    sourceParams: source.sourceParams,
                  }),
                },
              })
              canvas.add(img)
              canvas.renderAll()
              message.success('PDF 第一页已添加到画布')
              resolve()
            },
            { crossOrigin: 'anonymous' }
          )
        })
      } else if (isSvg) {
        // 对于 SVG，直接用 readImageAsDataUrl 读取（它已经支持 SVG），然后用 fabric.loadSVGFromURL 加载
        // 这样和直接上传 SVG 文件一样快
        console.log('使用 readImageAsDataUrl 读取 SVG，然后用 fabric.loadSVGFromURL 加载...')
        const result = await window.electronAPI.readImageAsDataUrl(finalImagePath)
        
        if (!result.success || !result.dataUrl) {
          console.error('读取 SVG 失败:', result.error)
          message.error(`读取 SVG 失败: ${result.error || '未知错误'}`)
          return
        }

        const svgDataUrl = result.dataUrl
        // 使用 fabric.loadSVGFromURL 加载 SVG（和直接上传 SVG 文件一样）
        await new Promise<void>((resolve) => {
        fabric.loadSVGFromURL(
            svgDataUrl,
          (objects, options) => {
            if (!fabricCanvasRef.current) {
              console.error('Canvas 未初始化')
              message.error('画布未初始化')
                resolve()
              return
            }

            const canvas = fabricCanvasRef.current
            const canvasWidth = canvas.width || 1200
            const canvasHeight = canvas.height || 800

            // 创建 SVG 对象组
            const svgObject = fabric.util.groupSVGElements(objects, options)
            
            if (!svgObject) {
              console.error('SVG 对象创建失败')
              message.error('SVG 加载失败')
                resolve()
              return
            }

            console.log('SVG 加载成功，尺寸:', svgObject.width, 'x', svgObject.height)

            // 计算缩放比例，使 SVG 适应画布（保持宽高比）
            const svgWidth = svgObject.width || 0
            const svgHeight = svgObject.height || 0
            const scale = Math.min(
              (canvasWidth * 0.8) / svgWidth,
              (canvasHeight * 0.8) / svgHeight,
              1 // 不超过原始大小
            )

            svgObject.set({
              left: (canvasWidth - svgWidth * scale) / 2,
              top: (canvasHeight - svgHeight * scale) / 2,
              scaleX: scale,
              scaleY: scale,
            })

            canvas.add(svgObject)
            canvas.renderAll()
            console.log('SVG 已添加到画布，位置:', svgObject.left, svgObject.top, '缩放:', scale)
            message.success('SVG 已添加到画布（矢量图，缩放不失真）')
              resolve()
          },
          (error: unknown) => {
            console.error('SVG 加载失败:', error)
            message.error(`SVG 加载失败: ${error instanceof Error ? error.message : '未知错误'}`)
              resolve()
          }
        )
        })
      } else {
        // 对于普通图片，使用原来的方法
        // 通过主进程读取图片并转换为 data URL
        const result = await window.electronAPI.readImageAsDataUrl(finalImagePath)
        
        if (!result.success || !result.dataUrl) {
          console.error('读取图片失败:', result.error)
          message.error(`读取图片失败: ${result.error || '未知错误'}`)
          return
        }

        const transparentDataUrl = await stripBorderWhiteToTransparent(result.dataUrl, 246)
        // 使用 data URL 加载图片
        console.log('开始使用 fabric.Image.fromURL 加载图片，data URL 长度:', transparentDataUrl?.length)
        await new Promise<void>((resolve) => {
        fabric.Image.fromURL(
            transparentDataUrl,
          (img) => {
            if (!fabricCanvasRef.current) {
              console.error('Canvas 未初始化')
              message.error('画布未初始化')
                resolve()
              return
            }

            console.log('图片加载成功，尺寸:', img.width, 'x', img.height)

            // 设置图片位置（居中）
            const canvas = fabricCanvasRef.current
            const canvasWidth = canvas.width || 1200
            const canvasHeight = canvas.height || 800
            const imgWidth = img.width || 0
            const imgHeight = img.height || 0
            
            // 计算缩放比例，使图片适应画布（保持宽高比）
            const scale = Math.min(
              (canvasWidth * 0.8) / imgWidth,
              (canvasHeight * 0.8) / imgHeight,
              1 // 不超过原始大小
            )

            img.set({
              left: (canvasWidth - imgWidth * scale) / 2,
              top: (canvasHeight - imgHeight * scale) / 2,
              scaleX: scale,
              scaleY: scale,
                data: {
                  originalDataUrl: transparentDataUrl,
                  rawOriginalDataUrl: result.dataUrl,
                  bgStripEnabled: true,
                  bgStripThreshold: 246,
                  ...(source?.outputDir && {
                    outputDir: source.outputDir,
                    sourceFunctionName: source.functionName,
                    sourcePackageName: source.packageName,
                    rdsFile: source.rdsFile || 'heatmap.rds',
                    sourceParams: source.sourceParams,
                  }),
                },
            })

            canvas.add(img)
            canvas.renderAll()
            console.log('图片已添加到画布，位置:', img.left, img.top, '缩放:', scale)
            message.success('图片已添加到画布')
              resolve()
          },
          {
            crossOrigin: 'anonymous',
          }
        )
        })
      }
    } catch (error) {
      console.error('加载失败:', error)
      message.error(`加载失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [])

  const processAddImageQueue = useCallback(async () => {
    if (addImageProcessingRef.current) return
    addImageProcessingRef.current = true
    emitAddQueueStatus()
    try {
      while (addImageQueueRef.current.length > 0) {
        const task = addImageQueueRef.current.shift()
        if (!task) break
        addImageCurrentPathRef.current = task.imagePath
        emitAddQueueStatus()
        try {
          await addImageToCanvas(task.imagePath, task.source)
        } finally {
          addImageCurrentPathRef.current = null
          addImageQueuedSetRef.current.delete(task.key)
          emitAddQueueStatus()
        }
        // 让主线程有机会先渲染，避免连续点击时界面“发黏”
        await new Promise<void>((resolve) => window.setTimeout(resolve, 16))
      }
    } finally {
      addImageProcessingRef.current = false
      emitAddQueueStatus()
    }
  }, [addImageToCanvas, emitAddQueueStatus])

  const enqueueAddImageToCanvas = useCallback((
    imagePath: string,
    source?: { outputDir?: string; functionName?: string; packageName?: string; rdsFile?: string; sourceParams?: Record<string, unknown> }
  ) => {
    const key = `${imagePath}::${source?.outputDir || ''}`
    // 快速连点同一项时只保留一个待处理任务，避免堆积卡顿
    if (addImageQueuedSetRef.current.has(key)) return
    addImageQueuedSetRef.current.add(key)
    addImageQueueRef.current.push({ imagePath, source, key })
    emitAddQueueStatus()
    void processAddImageQueue()
  }, [processAddImageQueue, emitAddQueueStatus])

  useEffect(() => {
    if (!canvasRef.current) return

    try {
      // 初始化 Fabric.js Canvas，背景设为透明以显示网格
      fabricCanvasRef.current = new fabric.Canvas(canvasRef.current, {
        width: 1200,
        height: 800,
        backgroundColor: 'transparent', // 透明背景，显示 CSS 网格
        selectionLineWidth: 1, // 拖拽框选时的线条更细
      })
      // 选中对象时框选线更细（borderScaleFactor 默认 1，调小则更细）
      const FabricObject = (fabric as typeof FabricType & { Object?: { prototype?: { set?: (opts: Record<string, unknown>) => void } } }).Object
      if (FabricObject?.prototype?.set) {
        FabricObject.prototype.set({ borderScaleFactor: 0.5 })
      }

      // 网格背景通过 CSS 实现，不需要在 canvas 中添加

      // 监听添加图片事件
      const handleAddImage = (event: Event) => {
        const customEvent = event as CustomEvent<{ imagePath: string; outputDir?: string; functionName?: string; packageName?: string; rdsFile?: string; sourceParams?: Record<string, unknown> }>
        if (customEvent.detail?.imagePath) {
          const d = customEvent.detail
          const source = d.outputDir
            ? { outputDir: d.outputDir, functionName: d.functionName, packageName: d.packageName, rdsFile: d.rdsFile, sourceParams: d.sourceParams }
            : undefined
          enqueueAddImageToCanvas(d.imagePath, source)
        }
      }

      // 监听导出画布事件
      const handleExportCanvas = () => {
        console.log('收到导出画布事件，canvas 状态:', !!fabricCanvasRef.current)
        if (fabricCanvasRef.current) {
          try {
            const canvasData = fabricCanvasRef.current.toJSON()
            // 按有效内容边界导出，避免大面积空白导致“看起来不居中”
            const isGuideObject = (o: FabricType.Object) =>
              Boolean((o as FabricType.Object & { data?: { __alignGuide?: boolean } }).data?.__alignGuide)
            const exportTargets = fabricCanvasRef.current
              .getObjects()
              .filter((o) => !isGuideObject(o) && o.visible !== false)
            let imageDataUrl = ''
            if (exportTargets.length === 0) {
              imageDataUrl = fabricCanvasRef.current.toDataURL({
                format: 'png',
                quality: 1,
                multiplier: 2,
              })
            } else {
              const canvasW = fabricCanvasRef.current.getWidth()
              const canvasH = fabricCanvasRef.current.getHeight()
              let minX = Infinity
              let minY = Infinity
              let maxX = -Infinity
              let maxY = -Infinity
              for (const obj of exportTargets) {
                const rect = obj.getBoundingRect(true, true)
                minX = Math.min(minX, rect.left)
                minY = Math.min(minY, rect.top)
                maxX = Math.max(maxX, rect.left + rect.width)
                maxY = Math.max(maxY, rect.top + rect.height)
              }
              // 始终按“可见内容边界”裁剪导出，再由 PDF 端居中排版。
              // 这样无论对象在画布里怎么挪位置，导出视觉都不会偏到一侧。
              const padding = 20
              const left = Math.max(0, Math.floor(minX - padding))
              const top = Math.max(0, Math.floor(minY - padding))
              const right = Math.min(canvasW, Math.ceil(maxX + padding))
              const bottom = Math.min(canvasH, Math.ceil(maxY + padding))
              const safeWidth = Math.max(1, right - left)
              const safeHeight = Math.max(1, bottom - top)
              imageDataUrl = fabricCanvasRef.current.toDataURL({
              format: 'png',
              quality: 1,
              multiplier: 2, // 提高分辨率
                left,
                top,
                width: safeWidth,
                height: safeHeight,
            })
            }
            // 获取 SVG 字符串
            const svgString = fabricCanvasRef.current.toSVG()
            console.log('画布数据已获取，imageDataUrl 长度:', imageDataUrl?.length, 'SVG 长度:', svgString?.length)
            const event = new CustomEvent('canvas-data', { 
              detail: { 
                json: canvasData,
                imageDataUrl: imageDataUrl,
                svgString: svgString
              } 
            })
            window.dispatchEvent(event)
          } catch (error) {
            console.error('获取画布数据失败:', error)
            // 即使出错也发送事件，避免 Promise 一直等待
            const errorEvent = new CustomEvent('canvas-data', { 
              detail: { 
                error: error instanceof Error ? error.message : '获取画布数据失败'
              } 
            })
            window.dispatchEvent(errorEvent)
          }
        } else {
          console.warn('Canvas 尚未初始化，无法导出')
          // 即使 canvas 未初始化也发送事件，避免 Promise 一直等待
          const errorEvent = new CustomEvent('canvas-data', { 
            detail: { 
              error: '画布尚未初始化，请稍候再试'
            } 
          })
          window.dispatchEvent(errorEvent)
        }
      }

      // 选中图片时显示填色面板（只认单张图，不认组；填色是对原图做参数化调整，不另建一层）
      const canvas = fabricCanvasRef.current
      const isAlignGuideObject = (obj: FabricType.Object | null | undefined) =>
        Boolean((obj as FabricType.Object & { data?: { __alignGuide?: boolean } } | null)?.data?.__alignGuide)
      const ensureAlignGuideLines = () => {
        if (alignGuideLinesRef.current.v && alignGuideLinesRef.current.h) return
        const v = new fabric.Line([0, 0, 0, canvas.getHeight()], {
          stroke: '#2f54eb',
          strokeWidth: 1.5,
          strokeDashArray: [6, 4],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          visible: false,
        })
        const h = new fabric.Line([0, 0, canvas.getWidth(), 0], {
          stroke: '#2f54eb',
          strokeWidth: 1.5,
          strokeDashArray: [6, 4],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          visible: false,
        })
        ;(v as FabricType.Object & { data?: { __alignGuide?: boolean } }).data = { __alignGuide: true }
        ;(h as FabricType.Object & { data?: { __alignGuide?: boolean } }).data = { __alignGuide: true }
        canvas.add(v)
        canvas.add(h)
        alignGuideLinesRef.current = { v, h }
      }
      const hideAlignGuideLines = () => {
        const { v, h } = alignGuideLinesRef.current
        if (v) v.set({ visible: false })
        if (h) h.set({ visible: false })
      }
      const updateAlignGuideLines = (x: number | null, y: number | null) => {
        ensureAlignGuideLines()
        const { v, h } = alignGuideLinesRef.current
        if (v) {
          if (x === null) {
            v.set({ visible: false })
          } else {
            v.set({ x1: x, y1: 0, x2: x, y2: canvas.getHeight(), visible: true })
          }
        }
        if (h) {
          if (y === null) {
            h.set({ visible: false })
          } else {
            h.set({ x1: 0, y1: y, x2: canvas.getWidth(), y2: y, visible: true })
          }
        }
        if (v) canvas.bringToFront(v)
        if (h) canvas.bringToFront(h)
      }
      const snapObjectByGuides = (target: FabricType.Object, bypassSnap: boolean) => {
        if (bypassSnap || (!alignAssistEnabledRef.current && !gridSnapEnabledRef.current) || isAlignGuideObject(target)) {
          hideAlignGuideLines()
          return
        }
        const guideTolerance = 12
        const rect = target.getBoundingRect(true, true)
        const center = target.getCenterPoint()
        const xMetrics = [
          { v: rect.left },
          { v: rect.left + rect.width / 2 },
          { v: rect.left + rect.width },
        ]
        const yMetrics = [
          { v: rect.top },
          { v: rect.top + rect.height / 2 },
          { v: rect.top + rect.height },
        ]
        const xCandidates: number[] = [canvas.getWidth() / 2]
        const yCandidates: number[] = [canvas.getHeight() / 2]
        for (const obj of canvas.getObjects()) {
          if (obj === target || isAlignGuideObject(obj) || obj.visible === false) continue
          const r = obj.getBoundingRect(true, true)
          xCandidates.push(r.left, r.left + r.width / 2, r.left + r.width)
          yCandidates.push(r.top, r.top + r.height / 2, r.top + r.height)
        }
        let bestX: { abs: number; delta: number; guide: number } | null = null
        let bestY: { abs: number; delta: number; guide: number } | null = null
        for (const m of xMetrics) {
          for (const c of xCandidates) {
            const delta = c - m.v
            const abs = Math.abs(delta)
            if (abs <= guideTolerance && (!bestX || abs < bestX.abs)) bestX = { abs, delta, guide: c }
          }
        }
        for (const m of yMetrics) {
          for (const c of yCandidates) {
            const delta = c - m.v
            const abs = Math.abs(delta)
            if (abs <= guideTolerance && (!bestY || abs < bestY.abs)) bestY = { abs, delta, guide: c }
          }
        }
        const gridSize = Math.max(4, gridSnapSizeRef.current || 10)
        const gridX = Math.round(rect.left / gridSize) * gridSize
        const gridY = Math.round(rect.top / gridSize) * gridSize
        const gridDx = gridX - rect.left
        const gridDy = gridY - rect.top
        // 优先参考线吸附；未命中时再用网格吸附
        const dx = bestX?.delta ?? (gridSnapEnabledRef.current ? gridDx : 0)
        const dy = bestY?.delta ?? (gridSnapEnabledRef.current ? gridDy : 0)
        if (dx || dy) {
          target.setPositionByOrigin(
            new fabric.Point(center.x + dx, center.y + dy),
            'center',
            'center',
          )
          target.setCoords()
        }
        const gx = bestX ? bestX.guide : (gridSnapEnabledRef.current ? gridX : null)
        const gy = bestY ? bestY.guide : (gridSnapEnabledRef.current ? gridY : null)
        updateAlignGuideLines(gx, gy)
      }
      const resizeCanvasToWrapper = () => {
        const c = fabricCanvasRef.current
        const wrapper = canvasWrapperRef.current
        if (!c || !wrapper) return
        const style = window.getComputedStyle(wrapper)
        const paddingX = (parseFloat(style.paddingLeft || '0') || 0) + (parseFloat(style.paddingRight || '0') || 0)
        const paddingY = (parseFloat(style.paddingTop || '0') || 0) + (parseFloat(style.paddingBottom || '0') || 0)
        const nextW = Math.max(600, Math.floor(wrapper.clientWidth - paddingX))
        const nextH = Math.max(400, Math.floor(wrapper.clientHeight - paddingY))
        const curW = c.getWidth()
        const curH = c.getHeight()
        if (curW !== nextW || curH !== nextH) {
          // 记录缩放前内容中心，缩放后整体平移到新画布中心
          const objects = c.getObjects()
          let contentCx: number | null = null
          let contentCy: number | null = null
          if (objects.length > 0) {
            let minX = Infinity
            let minY = Infinity
            let maxX = -Infinity
            let maxY = -Infinity
            for (const obj of objects) {
              const rect = obj.getBoundingRect(true, true)
              minX = Math.min(minX, rect.left)
              minY = Math.min(minY, rect.top)
              maxX = Math.max(maxX, rect.left + rect.width)
              maxY = Math.max(maxY, rect.top + rect.height)
            }
            if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
              contentCx = (minX + maxX) / 2
              contentCy = (minY + maxY) / 2
            }
          }
          c.setDimensions({ width: nextW, height: nextH })
          if (contentCx !== null && contentCy !== null) {
            const targetCx = nextW / 2
            const targetCy = nextH / 2
            const dx = targetCx - contentCx
            const dy = targetCy - contentCy
            for (const obj of c.getObjects()) {
              obj.set({
                left: (obj.left ?? 0) + dx,
                top: (obj.top ?? 0) + dy,
              })
              // 对绝对定位的 clipPath 一并平移，保证局部填色贴片不偏移
              const cp = (obj as any).clipPath
              if (cp && cp.absolutePositioned) {
                cp.set({
                  left: (cp.left ?? 0) + dx,
                  top: (cp.top ?? 0) + dy,
                })
                cp.setCoords?.()
              }
              obj.setCoords()
            }
          }
          c.requestRenderAll()
        }
      }
      resizeCanvasToWrapper()
      window.addEventListener('resize', resizeCanvasToWrapper)
      let resizeObserver: ResizeObserver | null = null
      if (typeof ResizeObserver !== 'undefined' && canvasWrapperRef.current) {
        resizeObserver = new ResizeObserver(() => resizeCanvasToWrapper())
        resizeObserver.observe(canvasWrapperRef.current)
      }
      const onSelection = () => {
        const active = canvas.getActiveObject()
        setSelectedObject(active ?? null)
        // 若选中的是填色选区矩形，保留当前填色面板（不清 selectedImageData）
        if (active === recolorRegionRectRef.current) {
          return
        }
        const data = (active as any)?.data
        if (active?.type === 'image' && data?.originalDataUrl) {
          setSelectedImageData({ obj: active, originalDataUrl: data.originalDataUrl })
          if (data.recolorParams?.oldColors?.length) setRecolorOldColors(data.recolorParams.oldColors)
          if (data.recolorParams?.newColors?.length) setRecolorNewColors(data.recolorParams.newColors)
          if (data.recolorParams?.mode === 'solid' || data.recolorParams?.mode === 'gradient') setRecolorMode(data.recolorParams.mode)
          if (typeof data.recolorParams?.onlyNearGradient === 'boolean') setRecolorOnlyNearGradient(data.recolorParams.onlyNearGradient)
        } else {
          setSelectedImageData(null)
        }
      }
      canvas.on('selection:created', onSelection)
      canvas.on('selection:updated', onSelection)
      canvas.on('selection:cleared', () => {
        hideAlignGuideLines()
        setSelectedObject(null)
        if (!recolorSelectingRef.current) {
          setSelectedImageData(null)
        }
      })
      // 支持滚轮/触控板双指缩放当前选中图片（避免必须拖拽边框控制点）
      const onMouseWheel = (opt: FabricType.IEvent<Event>) => {
        const e = opt.e as WheelEvent
        const active = canvas.getActiveObject()
        if (!active || active.type !== 'image') return
        // 仅在 Ctrl/Cmd（触控板捏合通常会带 ctrlKey）时触发，避免影响普通滚动
        if (!e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        e.stopPropagation()
        const delta = e.deltaY
        const scaleFactor = Math.exp(-delta * 0.002)
        const prevW = active.getScaledWidth()
        const prevH = active.getScaledHeight()
        const curScaleX = active.scaleX ?? 1
        const curScaleY = active.scaleY ?? 1
        const nextScale = Math.max(0.05, Math.min(10, curScaleX * scaleFactor))
        active.set({
          scaleX: nextScale,
          scaleY: Math.max(0.05, Math.min(10, curScaleY * scaleFactor)),
        })
        const nextW = active.getScaledWidth()
        const nextH = active.getScaledHeight()
        active.set({
          left: (active.left ?? 0) - (nextW - prevW) / 2,
          top: (active.top ?? 0) - (nextH - prevH) / 2,
        })
        active.setCoords()
        canvas.requestRenderAll()
      }
      canvas.on('mouse:wheel', onMouseWheel)
      const onObjectMoving = (opt: FabricType.IEvent<Event>) => {
        const target = opt.target as FabricType.Object | undefined
        if (!target) return
        const e = opt.e as (MouseEvent & { altKey?: boolean }) | undefined
        const bypassSnap = Boolean(e?.altKey)
        snapObjectByGuides(target, bypassSnap)
      }
      const onMoveEnd = () => {
        hideAlignGuideLines()
        canvas.requestRenderAll()
      }
      canvas.on('object:moving', onObjectMoving)
      canvas.on('object:modified', onMoveEnd)
      canvas.on('mouse:up', onMoveEnd)

      const syncLayers = () => setLayers(canvas.getObjects().filter((o) => !isAlignGuideObject(o)).slice())
      canvas.on('object:added', syncLayers)
      canvas.on('object:removed', syncLayers)

      // 监听 window 事件，这样可以从 ResultView 传递过来
      window.addEventListener('add-image-to-canvas', handleAddImage)
      window.addEventListener('export-canvas', handleExportCanvas)

      return () => {
        try {
          canvas.off('selection:created', onSelection)
          canvas.off('selection:updated', onSelection)
          canvas.off('selection:cleared')
          canvas.off('mouse:wheel', onMouseWheel)
          canvas.off('object:moving', onObjectMoving)
          canvas.off('object:modified', onMoveEnd)
          canvas.off('mouse:up', onMoveEnd)
          canvas.off('object:added', syncLayers)
          canvas.off('object:removed', syncLayers)
          window.removeEventListener('resize', resizeCanvasToWrapper)
          resizeObserver?.disconnect()
          window.removeEventListener('add-image-to-canvas', handleAddImage)
          window.removeEventListener('export-canvas', handleExportCanvas)
          fabricCanvasRef.current?.dispose()
        } catch (error) {
          console.error('Failed to dispose canvas:', error)
        }
      }
    } catch (error) {
      console.error('Failed to initialize Fabric.js canvas:', error)
    }
  }, [enqueueAddImageToCanvas])

  // 打开拆分弹窗：将当前选中的图片转为 data URL 并传入
  const openSplitModal = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const obj = selectedObject
    if (!canvas || !obj || (obj as any).type !== 'image') {
      message.warning('请先选中一张图片')
      return
    }
    const img = obj as any
    const el = img._element || img.getElement?.()
    if (!el || !(el instanceof HTMLImageElement)) {
      message.error('无法获取图片数据')
      return
    }
    const w = el.naturalWidth || img.width || 1
    const h = el.naturalHeight || img.height || 1
    const tmp = document.createElement('canvas')
    tmp.width = w
    tmp.height = h
    const ctx = tmp.getContext('2d')
    if (!ctx) {
      message.error('无法创建画布')
      return
    }
    ctx.drawImage(el, 0, 0, w, h)
    const dataUrl = tmp.toDataURL('image/png')
    setSplitPayload({
      dataUrl,
      imgWidth: w,
      imgHeight: h,
      left: obj.left ?? 0,
      top: obj.top ?? 0,
      scaleX: obj.scaleX ?? 1,
      scaleY: obj.scaleY ?? 1,
      obj,
    })
  }, [selectedObject])

  // 复制当前选中图层（存 toObject 用于粘贴）
  const copyLayer = useCallback(() => {
    if (!selectedObject) {
      message.warning('请先选中一个图层')
      return
    }
    try {
      copiedObjectJsonRef.current = selectedObject.toObject() as Record<string, unknown>
      setHasCopied(true)
      message.success('已复制')
    } catch (e) {
      message.error('复制失败')
    }
  }, [selectedObject])

  // 粘贴图层（从复制的 toObject 还原并偏移）
  const pasteLayer = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const json = copiedObjectJsonRef.current
    if (!json) {
      message.warning('请先复制一个图层')
      return
    }
    const fabricUtil = (fabric as typeof FabricType & { util?: { enlivenObjects: (objs: unknown[], cb: (objs: FabricType.Object[]) => void) => void } }).util
    if (!fabricUtil?.enlivenObjects) {
      message.error('当前环境不支持粘贴')
      return
    }
    fabricUtil.enlivenObjects([json], (objs: FabricType.Object[]) => {
      if (!objs?.length || !fabricCanvasRef.current) return
      const obj = objs[0]
      const left = (typeof obj.left === 'number' ? obj.left : 0) + 15
      const top = (typeof obj.top === 'number' ? obj.top : 0) + 15
      obj.set({ left, top })
      fabricCanvasRef.current.add(obj)
      fabricCanvasRef.current.setActiveObject(obj)
      fabricCanvasRef.current.requestRenderAll()
      setLayers(fabricCanvasRef.current.getObjects().slice())
      setSelectedObject(obj)
      message.success('已粘贴')
    })
  }, [])

  // 删除当前选中图层
  const deleteLayer = useCallback((target?: FabricType.Object) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const obj = target ?? canvas.getActiveObject()
    if (!obj) {
      message.warning('请先选中要删除的图层')
      return
    }
    canvas.remove(obj)
    canvas.discardActiveObject()
    canvas.requestRenderAll()
    setLayers(canvas.getObjects().slice())
    setSelectedObject(null)
    setSelectedImageData(null)
    message.success('已删除')
  }, [])

  // 全局快捷键：Ctrl/Cmd+C 复制、Ctrl/Cmd+V 粘贴；Delete/Backspace 删除选中
  // 焦点在输入框/颜色选择器等可编辑区域时，不拦截复制粘贴，方便复制颜色十六进制等
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return false
      const el = target as HTMLElement
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el.isContentEditable ||
        !!el.closest?.('input, textarea, [contenteditable="true"], .ant-color-picker-trigger')
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!fabricCanvasRef.current) return
      const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c'
      const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v'
      const isDelete = e.key === 'Delete' || e.key === 'Backspace'
      const isHelp = e.key === '?' || (e.key === '/' && e.shiftKey)
      if (isHelp) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        setShortcutHelpOpen(true)
        return
      }
      if (isCopy) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        copyLayer()
      } else if (isPaste) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        pasteLayer()
      } else if (isDelete && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        deleteLayer()
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)) {
        if (e.repeat) return
        const key = e.key.toLowerCase()
        if (key === 'v') {
          e.preventDefault()
          setActiveTool('select')
        } else if (key === 'r') {
          e.preventDefault()
          if (!selectedImageData) {
            message.info('请先选中一张图片，再进行框选填色')
            return
          }
          setActiveTool('recolor')
          beginRecolorRegionSelectionRef.current?.()
        } else if (key === 't') {
          e.preventDefault()
          setActiveTool('text')
          addTextLayerRef.current?.()
        } else if (key === 's') {
          e.preventDefault()
          const isImage = Boolean(selectedObject && (selectedObject as FabricType.Object & { type?: string }).type === 'image')
          if (!isImage) {
            message.info('请先选中一张图片图层')
            return
          }
          setActiveTool('split')
          openSplitModalRef.current?.()
        } else if (key === 'd') {
          e.preventDefault()
          if (!selectedImageData) {
            message.info('请先选中一张图片，再使用重绘工具')
            return
          }
          setActiveTool('redraw')
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copyLayer, pasteLayer, deleteLayer, selectedImageData, selectedObject])

  // 记录最近一次使用的图片工具（填色/重绘），用于文本与图片切换时恢复上下文
  useEffect(() => {
    if (activeTool === 'recolor' || activeTool === 'redraw') {
      lastImageToolRef.current = activeTool
    }
  }, [activeTool])

  // 选中对象变化时自动切换工具上下文：文本 -> 文本工具；图片 -> 恢复最近图片工具
  useEffect(() => {
    if (!selectedObject) return
    const t = (selectedObject as FabricType.Object & { type?: string }).type
    const isText = t === 'i-text' || t === 'textbox' || t === 'text'
    if (isText) {
      if (activeTool !== 'text') setActiveTool('text')
      return
    }
    if (t === 'image' && activeTool === 'text') {
      setActiveTool(lastImageToolRef.current)
    }
  }, [selectedObject, activeTool])

  // 确认拆分：按区域裁剪并添加为多个图层，移除原图
  const handleSplitConfirm = useCallback(
    (regions: Rect[]) => {
      const canvas = fabricCanvasRef.current
      if (!canvas || !splitPayload || regions.length === 0) return
      const { dataUrl, left, top, scaleX, scaleY } = splitPayload
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        let done = 0
        const onCropAdded = () => {
          done++
          if (done === regions.length) {
            canvas.requestRenderAll()
            setLayers(canvas.getObjects().slice())
            message.success(`已新增 ${regions.length} 个图层（原图已保留）`)
          }
        }
        regions.forEach((r) => {
          const c = document.createElement('canvas')
          c.width = r.w
          c.height = r.h
          const ctx = c.getContext('2d')
          if (!ctx) {
            onCropAdded()
            return
          }
          // 不填充背景，保持透明
          ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
          const cropDataUrl = c.toDataURL('image/png')
          fabric.Image.fromURL(
            cropDataUrl,
            (fabricImg: any) => {
              fabricImg.set({
                left: left + r.x * scaleX,
                top: top + r.y * scaleY,
                scaleX,
                scaleY,
                data: { originalDataUrl: cropDataUrl },
              })
              canvas.add(fabricImg)
              onCropAdded()
            },
            { crossOrigin: 'anonymous' }
          )
        })
      }
      img.onerror = () => message.error('图片加载失败')
      img.src = dataUrl
      setSplitPayload(null)
    },
    [splitPayload]
  )

  // 添加文本图层（类似 PS 的文本层，独立一层）
  const addTextLayer = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) {
      message.warning('画布尚未初始化')
      return
    }
    const IText = (fabric as any).IText
    if (!IText) {
      message.error('当前环境不支持添加文本')
      return
    }
    const center = canvas.getCenter()
    const text = new IText('双击编辑文字', {
      left: (center?.left ?? 400) - 80,
      top: (center?.top ?? 300) - 14,
      fontSize: 24,
      fontFamily: textFontFamily,
      fontWeight: textFontWeight,
      fontStyle: textFontStyle,
      textAlign,
      underline: textUnderline,
      linethrough: textLinethrough,
      overline: textOverline,
      lineHeight: textLineHeight,
      charSpacing: textCharSpacing,
      fill: textFill,
    })
    canvas.add(text)
    canvas.setActiveObject(text)
    canvas.requestRenderAll()
    message.success('已添加文本层，双击可编辑')
  }, [textAlign, textCharSpacing, textFill, textFontFamily, textFontStyle, textFontWeight, textLineHeight, textLinethrough, textOverline, textUnderline])

  const adjustAllTextFontSize = useCallback((delta: number) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const texts = canvas.getObjects().filter((o) => {
      const t = (o as FabricType.Object & { type?: string }).type
      return t === 'i-text' || t === 'textbox' || t === 'text'
    }) as Array<FabricType.Object & { fontSize?: number; set: (key: string, value: unknown) => void }>
    if (texts.length === 0) {
      message.info('画布中暂无文本对象')
      return
    }
    for (const t of texts) {
      const next = Math.max(8, Math.min(300, Math.round((typeof t.fontSize === 'number' ? t.fontSize : 24) + delta)))
      t.set('fontSize', next)
      t.setCoords?.()
    }
    const active = canvas.getActiveObject() as (FabricType.Object & { type?: string; fontSize?: number }) | null
    if (active && (active.type === 'i-text' || active.type === 'textbox' || active.type === 'text')) {
      setTextFontSize(typeof active.fontSize === 'number' ? active.fontSize : textFontSize + delta)
    }
    canvas.requestRenderAll()
    message.success(`已调整 ${texts.length} 个文本对象字号`)
  }, [textFontSize])

  const setAllTextFontSize = useCallback((size: number) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const texts = canvas.getObjects().filter((o) => {
      const t = (o as FabricType.Object & { type?: string }).type
      return t === 'i-text' || t === 'textbox' || t === 'text'
    }) as Array<FabricType.Object & { set: (key: string, value: unknown) => void }>
    if (texts.length === 0) {
      message.info('画布中暂无文本对象')
      return
    }
    const next = Math.max(8, Math.min(300, Math.round(size)))
    for (const t of texts) {
      t.set('fontSize', next)
      t.setCoords?.()
    }
    setTextFontSize(next)
    canvas.requestRenderAll()
    message.success(`已将 ${texts.length} 个文本对象字号设为 ${next}`)
  }, [])

  const reorderLayerByObject = useCallback((source: FabricType.Object, target: FabricType.Object) => {
    const canvas = fabricCanvasRef.current
    if (!canvas || source === target) return
    const isGuide = (o: FabricType.Object) => Boolean((o as FabricType.Object & { data?: { __alignGuide?: boolean } }).data?.__alignGuide)
    const current = canvas.getObjects().filter((o) => !isGuide(o))
    const sourceIdx = current.indexOf(source)
    const targetIdx = current.indexOf(target)
    if (sourceIdx < 0 || targetIdx < 0 || sourceIdx === targetIdx) return

    const moveTo = (canvas as FabricType.Canvas & { moveTo?: (o: FabricType.Object, idx: number) => void }).moveTo
    if (typeof moveTo === 'function') {
      moveTo.call(canvas, source, targetIdx)
    } else if (sourceIdx < targetIdx) {
      for (let k = 0; k < targetIdx - sourceIdx; k += 1) canvas.bringForward(source)
    } else {
      for (let k = 0; k < sourceIdx - targetIdx; k += 1) canvas.sendBackwards(source)
    }
    canvas.setActiveObject(source)
    canvas.requestRenderAll()
    setLayers(canvas.getObjects().filter((o) => !isGuide(o)).slice())
  }, [])

  const applyCurrentTextStyleToAll = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const texts = canvas.getObjects().filter((o) => {
      const t = (o as FabricType.Object & { type?: string }).type
      return t === 'i-text' || t === 'textbox' || t === 'text'
    }) as Array<FabricType.Object & { set: (key: string, value: unknown) => void; setCoords?: () => void }>
    if (texts.length === 0) {
      message.info('画布中暂无文本对象')
      return
    }
    for (const t of texts) {
      if (textApplyFields.includes('fontSize')) t.set('fontSize', textFontSize)
      if (textApplyFields.includes('fill')) t.set('fill', textFill)
      if (textApplyFields.includes('fontFamily')) t.set('fontFamily', textFontFamily)
      if (textApplyFields.includes('fontWeight')) t.set('fontWeight', textFontWeight)
      if (textApplyFields.includes('fontStyle')) t.set('fontStyle', textFontStyle)
      if (textApplyFields.includes('textAlign')) t.set('textAlign', textAlign)
      if (textApplyFields.includes('underline')) t.set('underline', textUnderline)
      if (textApplyFields.includes('linethrough')) t.set('linethrough', textLinethrough)
      if (textApplyFields.includes('overline')) t.set('overline', textOverline)
      if (textApplyFields.includes('lineHeight')) t.set('lineHeight', textLineHeight)
      if (textApplyFields.includes('charSpacing')) t.set('charSpacing', textCharSpacing)
      t.setCoords?.()
    }
    canvas.requestRenderAll()
    message.success(`已将当前样式应用到 ${texts.length} 个文本对象`)
  }, [textAlign, textApplyFields, textCharSpacing, textFill, textFontFamily, textFontSize, textFontStyle, textFontWeight, textLineHeight, textLinethrough, textOverline, textUnderline])

  // 选中文本时同步右侧面板的字号、颜色、样式
  useEffect(() => {
    const obj = selectedObject
    const isText = obj && ((obj as FabricType.Object & { type?: string }).type === 'i-text' || (obj as FabricType.Object & { type?: string }).type === 'textbox' || (obj as FabricType.Object & { type?: string }).type === 'text')
    if (isText && obj) {
      const o = obj as FabricType.Object & {
        fontSize?: number
        fill?: string
        fontFamily?: string
        fontWeight?: string
        fontStyle?: string
        textAlign?: string
        underline?: boolean
        linethrough?: boolean
        overline?: boolean
        lineHeight?: number
        charSpacing?: number
      }
      setTextFontSize(typeof o.fontSize === 'number' ? o.fontSize : 24)
      setTextFill(typeof o.fill === 'string' ? o.fill : '#000000')
      setTextFontFamily(typeof o.fontFamily === 'string' ? o.fontFamily : 'sans-serif')
      setTextFontWeight(o.fontWeight === 'bold' ? 'bold' : 'normal')
      setTextFontStyle(o.fontStyle === 'italic' ? 'italic' : 'normal')
      setTextAlign(o.textAlign === 'center' || o.textAlign === 'right' ? o.textAlign : 'left')
      setTextUnderline(Boolean(o.underline))
      setTextLinethrough(Boolean(o.linethrough))
      setTextOverline(Boolean(o.overline))
      setTextLineHeight(typeof o.lineHeight === 'number' ? o.lineHeight : 1.2)
      setTextCharSpacing(typeof o.charSpacing === 'number' ? o.charSpacing : 0)
    }
  }, [selectedObject])

  // 选中图片时同步去白底参数
  useEffect(() => {
    if (!selectedImageData) return
    const data = (selectedImageData.obj as FabricType.Object & { data?: Record<string, unknown> }).data
    const enabled = typeof data?.bgStripEnabled === 'boolean' ? data.bgStripEnabled : true
    const threshold = typeof data?.bgStripThreshold === 'number' ? Math.max(220, Math.min(255, Math.round(data.bgStripThreshold))) : 246
    setBgStripEnabled(enabled)
    setBgStripThreshold(threshold)
  }, [selectedImageData])

  useEffect(() => {
    if (recolorRegion) setRecolorInlineError('')
  }, [recolorRegion])

  // 去白底实时应用：滑杆或开关变化后立即作用当前图片
  useEffect(() => {
    const canvas = fabricCanvasRef.current
    const img = selectedImageData?.obj
    if (!canvas || !img) return
    const data = (img as FabricType.Object & { data?: Record<string, unknown> }).data || {}
    const raw = (typeof data.rawOriginalDataUrl === 'string' && data.rawOriginalDataUrl) || (typeof data.originalDataUrl === 'string' ? data.originalDataUrl : '')
    if (!raw) return
    const dataEnabled = typeof data.bgStripEnabled === 'boolean' ? data.bgStripEnabled : true
    const dataThreshold = typeof data.bgStripThreshold === 'number'
      ? Math.max(220, Math.min(255, Math.round(data.bgStripThreshold)))
      : 246
    // 切换选中对象时，如果参数没变化，则不重复做像素级计算，避免卡顿
    if (dataEnabled === bgStripEnabled && dataThreshold === bgStripThreshold) return
    const current = typeof data.originalDataUrl === 'string' ? data.originalDataUrl : ''
    const seq = ++bgStripApplySeqRef.current
    const timer = window.setTimeout(async () => {
      const cacheKey = `${raw.length}:${raw.slice(0, 96)}:${bgStripThreshold}:${bgStripEnabled ? 1 : 0}`
      let nextUrl = bgStripEnabled ? bgStripCacheRef.current.get(cacheKey) || '' : raw
      if (bgStripEnabled && !nextUrl) {
        nextUrl = await stripBorderWhiteToTransparent(raw, bgStripThreshold)
        bgStripCacheRef.current.set(cacheKey, nextUrl)
        if (bgStripCacheRef.current.size > 80) {
          const firstKey = bgStripCacheRef.current.keys().next().value as string | undefined
          if (firstKey) bgStripCacheRef.current.delete(firstKey)
        }
      }
      if (seq !== bgStripApplySeqRef.current) return
      if (nextUrl === current && data.bgStripEnabled === bgStripEnabled && data.bgStripThreshold === bgStripThreshold) return
      const left = (img as FabricType.Object).left ?? 0
      const top = (img as FabricType.Object).top ?? 0
      const scaleX = (img as FabricType.Object).scaleX ?? 1
      const scaleY = (img as FabricType.Object).scaleY ?? 1
      ;(img as FabricType.Object & { setSrc: (u: string, cb: (o: FabricType.Object) => void) => void }).setSrc(nextUrl, (updated: FabricType.Object) => {
        updated.set({ left, top, scaleX, scaleY })
        const nextData = { ...data, originalDataUrl: nextUrl, rawOriginalDataUrl: raw, bgStripEnabled, bgStripThreshold }
        updated.set('data', nextData)
        canvas.requestRenderAll()
        setSelectedImageData((prev) => (prev && prev.obj === img && prev.originalDataUrl !== nextUrl
          ? { ...prev, originalDataUrl: nextUrl }
          : prev))
      })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [bgStripEnabled, bgStripThreshold, selectedImageData])

  // 选中图片时：有来源则解析 redrawConfig；无来源（本地上传）则拉取「所有支持重绘的方法」供用户选择
  useEffect(() => {
    if (!selectedImageData) {
      setRedrawConfig(null)
      setRedrawPreviewDataUrl(null)
      return
    }
    setRedrawPreviewDataUrl(null)
    const data = (selectedImageData.obj as FabricType.Object & { data?: Record<string, unknown> }).data
    const outputDir = data?.outputDir as string | undefined
    const sourceFunctionName = data?.sourceFunctionName as string | undefined
    const sourcePackageName = data?.sourcePackageName as string | undefined
    const hasSource = Boolean(outputDir && sourceFunctionName)

    let cancelled = false
    window.electronAPI.getAllFunctionDocs?.().then((res) => {
      if (cancelled || !res.success || !res.docs) return
      const docs = res.docs as Array<{
        name: string
        package?: string
        redrawFunction?: string
        redrawParameters?: RedrawParameterDef[]
      }>
      const withRedraw = docs.filter((d) => d.redrawFunction).map((d) => ({
        key: `${d.redrawFunction!}::${d.package || 'OmicsFlowCoreFullVersion'}`,
        sourceName: d.name,
        redrawFunctionName: d.redrawFunction!,
        packageName: d.package || 'OmicsFlowCoreFullVersion',
        redrawParameters: Array.isArray(d.redrawParameters) ? d.redrawParameters : undefined,
      }))
      setRedrawMethodOptions(withRedraw)
      if (withRedraw.length > 0 && !selectedManualRedrawKey) setSelectedManualRedrawKey(withRedraw[0].key)
      if (hasSource) {
        const entry = docs.find(
          (d) => d.name === sourceFunctionName && (!sourcePackageName || d.package === sourcePackageName)
        )
        // 若 function-docs 中配置了 redrawFunction 则用配置的，否则用运行时的函数名（同一函数既可运行也可重绘）
        const redrawName = entry?.redrawFunction ?? sourceFunctionName
        const pkg = sourcePackageName || entry?.package || 'OmicsFlowCoreFullVersion'
        if (redrawName) {
          setRedrawConfig({
            redrawFunctionName: redrawName,
            packageName: pkg,
            redrawParameters: Array.isArray(entry?.redrawParameters) ? entry.redrawParameters : undefined,
          })
        } else {
          setRedrawConfig(null)
        }
      } else {
        setRedrawConfig(null)
      }
    }).catch(() => {
      setRedrawConfig(null)
      setRedrawMethodOptions([])
    })
    return () => { cancelled = true }
  }, [selectedImageData])

  useEffect(() => {
    if (!selectedImageData) return
    const data = (selectedImageData.obj as FabricType.Object & { data?: Record<string, unknown> }).data
    const sp = (data?.sourceParams as Record<string, unknown> | undefined) || {}
    const defs = redrawConfig?.redrawParameters || []
    const next: Record<string, unknown> = {}
    for (const d of defs) {
      if (!d?.name) continue
      const n = d.name
      if (['rds_file', 'out_file', 'palette', 'annotation_colors_list', 'fontsize', 'width', 'height', 'image_format', 'dpi', 'show_gene_names'].includes(n)) continue
      next[n] = sp[n] ?? d.default ?? ''
    }
    setRedrawExtraParams(next)
  }, [selectedImageData, redrawConfig])

  useEffect(() => {
    const defs = redrawConfig?.redrawParameters || []
    const getDef = (name: string) => defs.find((d) => d.name === name)
    const fmt = getDef('image_format')?.default
    if (fmt === 'png' || fmt === 'pdf') setRedrawImageFormat(fmt)
    const dpiDef = getDef('dpi')?.default
    if (typeof dpiDef === 'number' && Number.isFinite(dpiDef)) setRedrawDpi(dpiDef)
  }, [redrawConfig])

  // 有 sourceParams 时用其初始化「新参数」表单（颜色、字号、宽高、注释颜色），便于对比与重绘
  useEffect(() => {
    if (!selectedImageData) return
    const data = (selectedImageData.obj as FabricType.Object & { data?: Record<string, unknown> }).data
    const sp = data?.sourceParams as Record<string, unknown> | undefined
    if (!sp || typeof sp !== 'object') return
    if (typeof sp.fontsize === 'number') setRedrawFontSize(sp.fontsize)
    if (typeof sp.width === 'number') setRedrawWidth(sp.width)
    if (typeof sp.height === 'number') setRedrawHeight(sp.height)
    if (typeof sp.show_gene_names === 'boolean') setRedrawShowGeneNames(sp.show_gene_names)
    if (typeof sp.image_format === 'string' && (sp.image_format === 'png' || sp.image_format === 'pdf')) {
      setRedrawImageFormat(sp.image_format)
    }
    if (typeof sp.dpi === 'number' && Number.isFinite(sp.dpi)) setRedrawDpi(sp.dpi)
    const pal = sp.palette
    if (Array.isArray(pal) && pal.length >= 3) {
      const hexes = pal.map((c) => toHexColor(c)).filter(Boolean) as string[]
      if (hexes.length >= 3) setRedrawPalette(hexes)
    }
    const ann = parseAnnotationColors(sp)
    if (ann.control) setRedrawAnnotationGroupControl(ann.control)
    if (ann.disease) setRedrawAnnotationGroupDisease(ann.disease)
    const dsLevels = Array.isArray(sp.annotation_dataset_levels)
      ? sp.annotation_dataset_levels.filter((x): x is string => typeof x === 'string')
      : []
    const dsList = Array.isArray(sp.annotation_dataset_list)
      ? sp.annotation_dataset_list.filter((x): x is string => typeof x === 'string')
      : []
    if (dsLevels.length > 0) {
      setRedrawDatasetNamesList(dsLevels)
    } else if (dsList.length > 0) {
      setRedrawDatasetNamesList(dsList)
    } else if (Object.keys(ann.datasetMap).length > 0) {
      setRedrawDatasetNamesList(Object.keys(ann.datasetMap))
    }
    if (Object.keys(ann.datasetMap).length > 0) {
      setRedrawAnnotationDataset(ann.datasetMap)
    } else if (sp.annotation_dataset && typeof sp.annotation_dataset === 'object' && !Array.isArray(sp.annotation_dataset)) {
      const rec = sp.annotation_dataset as Record<string, unknown>
      const normalized = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, toHexColor(v)]).filter(([, v]) => Boolean(v)))
      setRedrawAnnotationDataset(normalized)
    }
  }, [selectedImageData])

  // 展开状态下支持拖拽调整面板宽度
  useEffect(() => {
    if (recolorPanelCollapsed) return
    const MIN_W = 300
    const MAX_W = 560
    const onMove = (e: MouseEvent) => {
      const start = recolorResizeStartRef.current
      if (!start) return
      const next = Math.min(MAX_W, Math.max(MIN_W, start.w + start.x - e.clientX))
      setRecolorPanelWidth(next)
    }
    const onUp = () => {
      recolorResizeStartRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    const onDown = (e: Event) => {
      const me = e as MouseEvent
      if (me.button !== 0) return
      recolorResizeStartRef.current = { x: me.clientX, w: recolorPanelWidthRef.current }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    const el = document.querySelector(`.${styles.recolorPanelResizer}`)
    if (!el) return
    el.addEventListener('mousedown', onDown as EventListener)
    return () => {
      el.removeEventListener('mousedown', onDown as EventListener)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [recolorPanelCollapsed, selectedImageData, selectedObject])

  // 应用填色：对原图做参数化调整（不新建图层）。始终用 originalDataUrl + 当前渐变重算，更新同一张图的显示，可反复改。
  // 若设置了 recolorRegion，则仅在该选区内重绘，其余区域完全不变。
  const applyRecolor = useCallback(async () => {
    if (!selectedImageData || !fabricCanvasRef.current) return
    const canvas = fabricCanvasRef.current
    const img = selectedImageData.obj
    const originalDataUrl = selectedImageData.originalDataUrl
    const left = img.left ?? 0
    const top = img.top ?? 0
    const scaleX = img.scaleX ?? 1
    const scaleY = img.scaleY ?? 1
    const region = (() => {
      const imgWidth = (img as any).width as number | undefined
      const imgHeight = (img as any).height as number | undefined
      if (!imgWidth || !imgHeight) return null
      const rect = recolorRegionRectRef.current
      if (rect) {
        rect.setCoords()
        const imgLeft = img.left ?? 0
        const imgTop = img.top ?? 0
        const sX = img.scaleX ?? 1
        const sY = img.scaleY ?? 1
        const rW = (rect.width ?? 0) * (rect.scaleX ?? 1)
        const rH = (rect.height ?? 0) * (rect.scaleY ?? 1)
        const localX0 = (rect.left! - imgLeft) / sX
        const localY0 = (rect.top! - imgTop) / sY
        const localW = rW / sX
        const localH = rH / sY
        const x0 = Math.max(0, Math.min(imgWidth, localX0))
        const y0 = Math.max(0, Math.min(imgHeight, localY0))
        const x1 = Math.max(0, Math.min(imgWidth, localX0 + localW))
        const y1 = Math.max(0, Math.min(imgHeight, localY0 + localH))
        const w = Math.max(0, x1 - x0)
        const h = Math.max(0, y1 - y0)
        if (w <= 0 || h <= 0) return null
        return {
          x: x0 / imgWidth,
          y: y0 / imgHeight,
          w: w / imgWidth,
          h: h / imgHeight,
        }
      }
      if (!recolorRegion) return null
      return recolorRegion
    })()
    // 现在无论渐变还是纯色，都要求先框选区域，再做局部调整
    if (!region) {
      setRecolorInlineError('请先框选热图区域')
      return
    }
    setRecolorInlineError('')
    // 纯色模式：只使用第一行颜色映射
    const effectiveOldColors =
      recolorMode === 'solid' ? [recolorOldColors[0]] : recolorOldColors
    const effectiveNewColors =
      recolorMode === 'solid' ? [recolorNewColors[0]] : recolorNewColors
    setRecolorApplying(true)
    try {
      const newDataUrl = await recolorImage(
        originalDataUrl,
        effectiveOldColors,
        effectiveNewColors,
        region,
        {
          mode: recolorMode,
          onlyRecolorNearGradient: recolorOnlyNearGradient,
          thresholdSq: 2500,
        }
      )
      const baseImg = img as any
      const imgWidth = (baseImg.width as number | undefined) ?? 0
      const imgHeight = (baseImg.height as number | undefined) ?? 0
      // 为当前框选区域创建一个新的覆盖图层，底层原图保持不变
      fabric.Image.fromURL(newDataUrl, (overlay) => {
        overlay.set({
          left,
          top,
          scaleX,
          scaleY,
          // 覆盖层只作为“着色贴片”：不参与鼠标命中，避免阻挡后续框选/拖拽
          selectable: false,
          evented: false,
          hasControls: false,
          lockMovementX: true,
          lockMovementY: true,
        })
        if (imgWidth > 0 && imgHeight > 0 && region) {
          const clipRect = new fabric.Rect({
            left: left + region.x * imgWidth * scaleX,
            top: top + region.y * imgHeight * scaleY,
            width: region.w * imgWidth * scaleX,
            height: region.h * imgHeight * scaleY,
            absolutePositioned: true,
          })
          overlay.clipPath = clipRect as any
        }
        const data = (overlay as any).data || {}
        overlay.set('data', {
          ...data,
          originalDataUrl,
          recolorParams: {
            oldColors: recolorOldColors,
            newColors: recolorNewColors,
            mode: recolorMode,
            onlyNearGradient: recolorOnlyNearGradient,
            region: recolorRegion || undefined,
            isRecolorOverlay: true,
          },
        })
        canvas.add(overlay)
        // 应用后回到原图选中，便于继续框选下一个区域
        canvas.setActiveObject(img as FabricType.Object)
        // 清除当前框选，方便用户直接再点「框选热图区域」画下一个选区
        if (recolorRegionRectRef.current) {
          canvas.remove(recolorRegionRectRef.current)
          recolorRegionRectRef.current = null
        }
        setRecolorRegion(null)
        canvas.requestRenderAll()
        setRecolorApplying(false)
      })
    } catch (e) {
      message.error('填色失败')
      console.error(e)
      setRecolorApplying(false)
    }
  }, [selectedImageData, recolorOldColors, recolorNewColors, recolorMode, recolorOnlyNearGradient, recolorRegion])

  /** 开始在当前选中图片上框选局部填色区域 */
  const beginRecolorRegionSelection = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const img = selectedImageData?.obj as (FabricType.Image & { width?: number; height?: number }) | undefined
    if (!canvas || !img) {
      message.warning('请先选中一张图片')
      return
    }
    const imgWidth = img.width || 0
    const imgHeight = img.height || 0
    if (!imgWidth || !imgHeight) {
      message.warning('无法获取图片尺寸')
      return
    }

    // 避免重复绑定监听：先清掉上一次未正常结束的框选会话
    if (recolorReenterTimerRef.current !== null) {
      window.clearTimeout(recolorReenterTimerRef.current)
      recolorReenterTimerRef.current = null
    }
    recolorSelectionCleanupRef.current?.()
    recolorSelectionCleanupRef.current = null

    recolorSelectingRef.current = true

    // 临时禁止图片自身被拖动/选择，只用于框选
    recolorRegionPrevStateRef.current = {
      selectable: (img as any).selectable !== false,
      evented: (img as any).evented !== false,
    }
    img.set({
      selectable: false,
      evented: false,
    })
    canvas.discardActiveObject()
    canvas.requestRenderAll()

    // 清除旧选区
    setRecolorRegion(null)
    if (recolorRegionRectRef.current) {
      canvas.remove(recolorRegionRectRef.current)
      recolorRegionRectRef.current = null
    }

    const handleMouseDown = (opt: any) => {
      const e = opt.e as MouseEvent
      if (e.button !== 0) return
      const pointer = canvas.getPointer(e)
      const imgLeft = img.left ?? 0
      const imgTop = img.top ?? 0
      const sX = img.scaleX ?? 1
      const sY = img.scaleY ?? 1
      const localX = (pointer.x - imgLeft) / sX
      const localY = (pointer.y - imgTop) / sY
      if (localX < 0 || localY < 0 || localX > imgWidth || localY > imgHeight) return
      recolorRegionStartRef.current = { x: localX, y: localY }

      const startCanvasX = imgLeft + localX * sX
      const startCanvasY = imgTop + localY * sY
      const rect = new fabric.Rect({
        left: startCanvasX,
        top: startCanvasY,
        width: 0,
        height: 0,
        fill: 'rgba(24,144,255,0.12)',
        stroke: '#1890ff',
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false,
      })
      recolorRegionRectRef.current = rect
      canvas.add(rect)
      canvas.bringToFront(rect)
      canvas.requestRenderAll()
    }

    const handleMouseMove = (opt: any) => {
      const start = recolorRegionStartRef.current
      const rect = recolorRegionRectRef.current
      if (!start || !rect) return
      const e = opt.e as MouseEvent
      const pointer = canvas.getPointer(e)
      const imgLeft = img.left ?? 0
      const imgTop = img.top ?? 0
      const sX = img.scaleX ?? 1
      const sY = img.scaleY ?? 1
      const localX = (pointer.x - imgLeft) / sX
      const localY = (pointer.y - imgTop) / sY
      const x0 = Math.max(0, Math.min(start.x, localX))
      const y0 = Math.max(0, Math.min(start.y, localY))
      const x1 = Math.min(imgWidth, Math.max(start.x, localX))
      const y1 = Math.min(imgHeight, Math.max(start.y, localY))
      const leftCanvas = imgLeft + x0 * sX
      const topCanvas = imgTop + y0 * sY
      rect.set({
        left: leftCanvas,
        top: topCanvas,
        width: Math.max(1, (x1 - x0) * sX),
        height: Math.max(1, (y1 - y0) * sY),
      })
      rect.setCoords()
      canvas.requestRenderAll()
    }

    const handleMouseUp = (opt: any) => {
      const start = recolorRegionStartRef.current
      const rect = recolorRegionRectRef.current
      recolorRegionStartRef.current = null
      cleanupSelectionSession()
      recolorSelectionCleanupRef.current = null
      if (!start) {
        if (rect) {
          canvas.remove(rect)
          recolorRegionRectRef.current = null
          canvas.requestRenderAll()
        }
        return
      }
      const e = opt.e as MouseEvent
      const pointer = canvas.getPointer(e)
      const imgLeft = img.left ?? 0
      const imgTop = img.top ?? 0
      const sX = img.scaleX ?? 1
      const sY = img.scaleY ?? 1
      const localX = (pointer.x - imgLeft) / sX
      const localY = (pointer.y - imgTop) / sY
      const x0 = Math.max(0, Math.min(start.x, localX))
      const y0 = Math.max(0, Math.min(start.y, localY))
      const x1 = Math.min(imgWidth, Math.max(start.x, localX))
      const y1 = Math.min(imgHeight, Math.max(start.y, localY))
      const w = x1 - x0
      const h = y1 - y0
      if (w < imgWidth * 0.02 || h < imgHeight * 0.02) {
        // 选区太小，视为无效
        if (rect) {
          canvas.remove(rect)
          recolorRegionRectRef.current = null
          canvas.requestRenderAll()
        }
        setRecolorRegion(null)
        return
      }
      const normRegion = {
        x: x0 / imgWidth,
        y: y0 / imgHeight,
        w: w / imgWidth,
        h: h / imgHeight,
      }
      setRecolorRegion(normRegion)

      // 纯色模式下，自动感知本次框选区域的主色，作为“旧色 1”
      if (recolorMode === 'solid' && selectedImageData?.originalDataUrl) {
        detectDominantColorInRegion(selectedImageData.originalDataUrl, normRegion).then((hex) => {
          if (!hex) return
          setRecolorOldColors((prev) => {
            const next = [...prev]
            next[0] = hex
            return next
          })
        })
      }

      // 框选结束后让矩形可拖动、可缩放（Fabric 控制点）
      if (rect) {
        rect.set({
          selectable: true,
          evented: true,
          hasBorders: true,
          hasControls: true,
          lockRotation: true,
        })
        rect.setCoords()
        // 默认选中本次新建的蓝框，方便立即拖动/缩放；如需选中其它图层，可在画布空白处或图层列表点击切换
        canvas.setActiveObject(rect)
        canvas.requestRenderAll()
      }
    }

    const cleanupSelectionSession = () => {
      canvas.off('mouse:down', handleMouseDown)
      canvas.off('mouse:move', handleMouseMove)
      canvas.off('mouse:up', handleMouseUp)
      const prev = recolorRegionPrevStateRef.current
      if (prev) {
        img.set({
          selectable: prev.selectable,
          evented: prev.evented,
        })
        recolorRegionPrevStateRef.current = null
      }
      recolorSelectingRef.current = false
      recolorRegionStartRef.current = null
    }
    recolorSelectionCleanupRef.current = cleanupSelectionSession

    canvas.on('mouse:down', handleMouseDown)
    canvas.on('mouse:move', handleMouseMove)
    canvas.on('mouse:up', handleMouseUp)
    message.info('在图片上拖拽框选需要填色的区域')
  }, [selectedImageData])

  /** 清除局部选区，恢复整图填色 */
  const clearRecolorRegion = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const activeImage = selectedImageData?.obj
    recolorSelectionCleanupRef.current?.()
    recolorSelectionCleanupRef.current = null
    if (recolorReenterTimerRef.current !== null) {
      window.clearTimeout(recolorReenterTimerRef.current)
      recolorReenterTimerRef.current = null
    }
    if (canvas && recolorRegionRectRef.current) {
      canvas.remove(recolorRegionRectRef.current)
      recolorRegionRectRef.current = null
      if (activeImage) {
        const data = (activeImage as FabricType.Object & { data?: Record<string, unknown> }).data
        canvas.setActiveObject(activeImage)
        setSelectedObject(activeImage)
        if (typeof data?.originalDataUrl === 'string' && data.originalDataUrl) {
          setSelectedImageData({ obj: activeImage, originalDataUrl: data.originalDataUrl })
        }
      }
      canvas.requestRenderAll()
    }
    setRecolorRegion(null)
    setRecolorInlineError('')
    // 填色工具下，清除后自动继续进入框选模式，避免每次都要再点一次按钮
    if (activeToolRef.current === 'recolor') {
      recolorReenterTimerRef.current = window.setTimeout(() => {
        recolorReenterTimerRef.current = null
        if (activeToolRef.current !== 'recolor') return
        beginRecolorRegionSelectionRef.current?.()
      }, 0)
    }
  }, [selectedImageData])

  // 切换到非填色工具时，强制退出框选监听，避免“切走后仍可框选”
  useEffect(() => {
    if (activeTool === 'recolor') return
    recolorSelectionCleanupRef.current?.()
    recolorSelectionCleanupRef.current = null
    if (recolorReenterTimerRef.current !== null) {
      window.clearTimeout(recolorReenterTimerRef.current)
      recolorReenterTimerRef.current = null
    }
  }, [activeTool])

  // 切换全屏
  const toggleFullscreen = () => {
    if (!containerRef.current) return
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = containerRef.current as any
    
    if (!isFullscreen) {
      // 进入全屏
      if (element.requestFullscreen) {
        element.requestFullscreen()
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen()
      } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen()
      } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen()
      }
      setIsFullscreen(true)
    } else {
      // 退出全屏
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = document as any
      if (doc.exitFullscreen) {
        doc.exitFullscreen()
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen()
      } else if (doc.mozCancelFullScreen) {
        doc.mozCancelFullScreen()
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen()
      }
      setIsFullscreen(false)
    }
  }

  // 监听全屏状态变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = document as any
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement
      )
      setIsFullscreen(isCurrentlyFullscreen)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [])

  // 画布引导：首次进入画布视图自动弹出一次；也支持外部/手动再次唤起（全屏时不自动弹）
  useEffect(() => {
    const onCanvasActivated = () => {
      if (localStorage.getItem(CANVAS_TOUR_SEEN_KEY) === '1') return
      setTimeout(() => {
        setCanvasTourCurrent(0)
        setCanvasTourOpen(true)
      }, 250)
    }
    const onStartTour = () => {
      setCanvasTourCurrent(0)
      setCanvasTourOpen(true)
    }
    window.addEventListener('canvas-view-activated', onCanvasActivated as EventListener)
    window.addEventListener('start-canvas-tour', onStartTour as EventListener)
    return () => {
      window.removeEventListener('canvas-view-activated', onCanvasActivated as EventListener)
      window.removeEventListener('start-canvas-tour', onStartTour as EventListener)
    }
  }, [])

  const oldList = [...recolorOldColors]
  while (oldList.length < 3) oldList.push('#cccccc')
  const newList = [...recolorNewColors]
  while (newList.length < 3) newList.push('#cccccc')
  const toInputColor = (hex: string) => {
    const n = toHexColor(hex)
    return /^#[0-9A-F]{6}$/.test(n) ? n : '#000000'
  }
  beginRecolorRegionSelectionRef.current = beginRecolorRegionSelection
  addTextLayerRef.current = addTextLayer
  openSplitModalRef.current = openSplitModal
  const isImageLayerSelected = Boolean(selectedObject && (selectedObject as FabricType.Object & { type?: string }).type === 'image')
  const isTextLayerSelected = Boolean(selectedObject && (() => {
    const o = selectedObject as FabricType.Object & { type?: string }
    return o.type === 'i-text' || o.type === 'textbox' || o.type === 'text'
  })())
  const isRecolorRegionRectSelected = Boolean(
    selectedObject
    && recolorRegionRectRef.current
    && selectedObject === recolorRegionRectRef.current
  )
  const showImageInspector = Boolean(
    selectedImageData
    && (
      (isImageLayerSelected && selectedObject && selectedImageData.obj === selectedObject)
      || recolorSelectingRef.current
      || isRecolorRegionRectSelected
    )
  )
  const canUseImageTools = showImageInspector
  const activeToolLabel = activeTool === 'select'
    ? '选择/移动（V）'
    : activeTool === 'recolor'
      ? `框选填色（R）${canUseImageTools ? '' : ' - 请先选中图片'}`
      : activeTool === 'redraw'
        ? `重绘（D）${canUseImageTools ? '' : ' - 请先选中图片'}`
        : activeTool === 'text'
          ? '文本（T）'
          : `拆分（S）${isImageLayerSelected ? '' : ' - 请先选中图片图层'}`
  const canvasTourStepsFocus = [
    {
      title: '左侧工具栏',
      description: '这里是画布主工具：选择、填色、文本、拆分、重绘，以及复制粘贴。',
      target: () => quickToolsTourRef.current ?? document.body,
    },
    {
      title: '图层面板',
      description: '可查看图层顺序、选中图层并调整上下层级。',
      target: () => layersTourRef.current ?? document.body,
    },
    {
      title: '画布编辑区',
      description: '把素材拖到这里后，即可移动、缩放、编辑。',
      target: () => canvasWrapperRef.current ?? document.body,
    },
    {
      title: '右侧属性面板',
      description: '选中图片后可进行填色/重绘，选中文本后可调文字样式。',
      target: () => panelTourRef.current ?? canvasWrapperRef.current ?? document.body,
    },
    {
      title: '再次查看引导',
      description: '点击这个按钮可随时重新打开画布引导。',
      target: () => canvasTourBtnRef.current ?? document.body,
    },
  ]
  const canvasTourSteps = canvasTourStepsFocus

  return (
    <div className={`${styles.layoutEditor} ${isFullscreen ? styles.fullscreen : ''}`} ref={containerRef}>
      <div className={styles.canvasContainer}>
        <div className={styles.layersPanel}>
          <div className={styles.quickToolsBar} ref={quickToolsTourRef}>
            <Tooltip placement="right" title="选择/移动 (V)">
              <Button
                type="text"
                icon={<PictureOutlined />}
                className={`${styles.quickToolBtn} ${activeTool === 'select' ? styles.quickToolBtnActive : ''}`}
                  title="选择/移动 (V)"
                onClick={() => setActiveTool('select')}
              />
            </Tooltip>
            <Tooltip placement="right" title={canUseImageTools ? '框选填色 (R)' : '框选填色（请先选中图片）'}>
              <span>
                <Button
                  type="text"
                  icon={<BgColorsOutlined />}
                  className={`${styles.quickToolBtn} ${activeTool === 'recolor' ? styles.quickToolBtnActive : ''}`}
                  disabled={!canUseImageTools}
                  title={canUseImageTools ? '框选填色 (R)' : '框选填色（请先选中图片）'}
                  onClick={() => {
                    setActiveTool('recolor')
                    beginRecolorRegionSelection()
                  }}
                />
              </span>
            </Tooltip>
            <Tooltip placement="right" title="文本工具 (T)">
              <Button
                type="text"
                icon={<FontSizeOutlined />}
                className={`${styles.quickToolBtn} ${activeTool === 'text' ? styles.quickToolBtnActive : ''}`}
                title="文本工具 (T)"
                onClick={() => {
                  setActiveTool('text')
                  addTextLayer()
                }}
              />
            </Tooltip>
            <Tooltip placement="right" title={isImageLayerSelected ? '拆分图层 (S)' : '拆分图层（请先选中图片图层）'}>
              <span>
                <Button
                  type="text"
                  icon={<ScissorOutlined />}
                  className={`${styles.quickToolBtn} ${activeTool === 'split' ? styles.quickToolBtnActive : ''}`}
                  disabled={!isImageLayerSelected}
                  title={isImageLayerSelected ? '拆分图层 (S)' : '拆分图层（请先选中图片图层）'}
                  onClick={() => {
                    setActiveTool('split')
                    openSplitModal()
                  }}
                />
              </span>
            </Tooltip>
            <Tooltip placement="right" title={canUseImageTools ? '重绘工具 (D)' : '重绘工具（请先选中图片）'}>
              <span>
                <Button
                  type="text"
                  icon={<ReloadOutlined />}
                  className={`${styles.quickToolBtn} ${activeTool === 'redraw' ? styles.quickToolBtnActive : ''}`}
                  disabled={!canUseImageTools}
                  title={canUseImageTools ? '重绘工具 (D)' : '重绘工具（请先选中图片）'}
                  onClick={() => setActiveTool('redraw')}
                />
              </span>
            </Tooltip>
            <div className={styles.quickToolDivider} />
            <Tooltip placement="right" title={selectedObject ? '复制图层 (Ctrl/Cmd+C)' : '复制图层（请先选中对象）'}>
              <span>
                <Button
                  type="text"
                  icon={<CopyOutlined />}
                  className={styles.quickToolBtn}
                  onClick={copyLayer}
                  disabled={!selectedObject}
                  title={selectedObject ? '复制图层 (Ctrl/Cmd+C)' : '复制图层（请先选中对象）'}
                />
              </span>
            </Tooltip>
            <Tooltip placement="right" title={hasCopied ? '粘贴图层 (Ctrl/Cmd+V)' : '粘贴图层（当前无可粘贴内容）'}>
              <span>
                <Button
                  type="text"
                  icon={<SnippetsOutlined />}
                  className={styles.quickToolBtn}
                  onClick={pasteLayer}
                  disabled={!hasCopied}
                  title={hasCopied ? '粘贴图层 (Ctrl/Cmd+V)' : '粘贴图层（当前无可粘贴内容）'}
                />
              </span>
            </Tooltip>
            {!isFullscreen && (
              <div ref={canvasTourBtnRef}>
                <Tooltip placement="right" title="画布引导">
                  <Button
                    type="text"
                    icon={<BulbOutlined />}
                    className={styles.quickToolBtn}
                    title="画布引导"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('start-canvas-tour'))
                    }}
                  />
                </Tooltip>
              </div>
            )}
            <Tooltip placement="right" title="快捷键帮助 (?)">
              <Button
                type="text"
                icon={<QuestionCircleOutlined />}
                className={`${styles.quickToolBtn} ${styles.quickToolBtnHelp}`}
                title="快捷键帮助 (?)"
                onClick={() => setShortcutHelpOpen(true)}
              />
            </Tooltip>
          </div>
          <div className={styles.layersMain} ref={layersTourRef}>
            <div className={styles.toolbarRow}>
              <div className={styles.toolbarHint}>当前工具：{activeToolLabel}</div>
              <div className={styles.alignAssistRow}>
                <span className={styles.alignAssistLabel}>参考线吸附</span>
                <Switch
                  size="small"
                  checked={alignAssistEnabled}
                  onChange={(checked) => {
                    setAlignAssistEnabled(checked)
                    if (!checked) {
                      const c = fabricCanvasRef.current
                      const guides = alignGuideLinesRef.current
                      guides.v?.set({ visible: false })
                      guides.h?.set({ visible: false })
                      c?.requestRenderAll()
                    }
                  }}
                />
              </div>
              <div className={styles.alignAssistRow}>
                <span className={styles.alignAssistLabel}>网格吸附</span>
                <Space size={6}>
                  <InputNumber
                    size="small"
                    min={4}
                    max={100}
                    step={1}
                    precision={0}
                    value={gridSnapSize}
                    disabled={!gridSnapEnabled}
                    onChange={(v) => {
                      if (typeof v !== 'number' || Number.isNaN(v)) return
                      setGridSnapSize(Math.max(4, Math.min(100, Math.round(v))))
                    }}
                    style={{ width: 66 }}
                  />
                  <Switch
                    size="small"
                    checked={gridSnapEnabled}
                    onChange={(checked) => {
                      setGridSnapEnabled(checked)
                      if (!checked && !alignAssistEnabledRef.current) {
                        const c = fabricCanvasRef.current
                        const guides = alignGuideLinesRef.current
                        guides.v?.set({ visible: false })
                        guides.h?.set({ visible: false })
                        c?.requestRenderAll()
                      }
                    }}
                  />
                </Space>
              </div>
              <div className={styles.alignAssistHint}>拖拽时按住 Alt 可临时关闭吸附</div>
            </div>
            <div className={styles.layersTitle}>图层</div>
            <div className={styles.layersList}>
              {layers.length === 0 ? (
                <div className={styles.layersEmpty}>暂无图层，拖入图片或添加文本</div>
              ) : (
                layers.slice().reverse().map((obj, i) => {
                  const realIndex = layers.length - 1 - i
                  const isImage = (obj as any).type === 'image'
                  const isText = (obj as any).type === 'i-text' || (obj as any).type === 'textbox' || (obj as any).type === 'text'
                  const rawText = isText ? String((obj as any).text ?? '').replace(/\s+/g, ' ').trim() : ''
                  const fullLabel = isText
                    ? (rawText || '文本')
                    : (isImage ? '图片' : '对象')
                  const isActive = selectedObject === obj
                  return (
                    <div
                      key={realIndex}
                      className={`${styles.layerItem} ${isActive ? styles.layerItemActive : ''}`}
                      draggable
                      onDragStart={(e) => {
                        draggingLayerRef.current = obj
                        e.dataTransfer.setData('text/plain', 'layer-reorder')
                        e.dataTransfer.effectAllowed = 'move'
                        const canvas = fabricCanvasRef.current
                        if (canvas) {
                          canvas.setActiveObject(obj)
                          canvas.requestRenderAll()
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault()
                        const source = draggingLayerRef.current
                        if (!source || source === obj) return
                        reorderLayerByObject(source, obj)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const source = draggingLayerRef.current
                        if (!source || source === obj) return
                        reorderLayerByObject(source, obj)
                      }}
                      onDragEnd={() => {
                        draggingLayerRef.current = null
                      }}
                      onClick={() => {
                        const canvas = fabricCanvasRef.current
                        if (canvas) {
                          canvas.setActiveObject(obj)
                          canvas.requestRenderAll()
                        }
                      }}
                    >
                      <span className={styles.layerIcon}>{isImage ? <PictureOutlined /> : <FontSizeOutlined />}</span>
                      <span className={styles.layerLabel} title={fullLabel}>{fullLabel}</span>
                      <div className={styles.layerMetaRow}>
                        <span className={styles.layerIndex}>{layers.length - realIndex}</span>
                        <span className={styles.layerActions} onClick={(e) => e.stopPropagation()}>
                          <Button
                            className={styles.layerMoveBtn}
                            type="text"
                            size="small"
                            icon={<ArrowUpOutlined />}
                            title="上移一层"
                            disabled={realIndex === layers.length - 1}
                            onClick={() => {
                              const c = fabricCanvasRef.current
                              if (c) {
                                c.bringForward(obj)
                                c.requestRenderAll()
                                setLayers(c.getObjects().filter((o) => !((o as FabricType.Object & { data?: { __alignGuide?: boolean } }).data?.__alignGuide)).slice())
                              }
                            }}
                          />
                          <Button
                            className={styles.layerMoveBtn}
                            type="text"
                            size="small"
                            icon={<ArrowDownOutlined />}
                            title="下移一层"
                            disabled={realIndex === 0}
                            onClick={() => {
                              const c = fabricCanvasRef.current
                              if (c) {
                                c.sendBackwards(obj)
                                c.requestRenderAll()
                                setLayers(c.getObjects().filter((o) => !((o as FabricType.Object & { data?: { __alignGuide?: boolean } }).data?.__alignGuide)).slice())
                              }
                            }}
                          />
                          <Button
                            className={styles.layerDeleteBtn}
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            title="删除图层 (Delete)"
                            onClick={() => deleteLayer(obj)}
                          />
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
        <div className={styles.canvasWrapper} ref={canvasWrapperRef}>
          <canvas ref={canvasRef} />
        </div>
        {(showImageInspector || isTextLayerSelected) && (
          <div
            className={`${styles.recolorPanelWrap} ${recolorPanelCollapsed ? styles.recolorPanelWrapCollapsed : ''}`}
            style={{
              width: recolorPanelCollapsed ? 34 : recolorPanelWidth,
              minWidth: recolorPanelCollapsed ? undefined : 300,
            }}
            ref={panelTourRef}
          >
            {!recolorPanelCollapsed && (
              <div className={styles.recolorPanelResizer} title="拖拽调整宽度" />
            )}
            <button
              type="button"
              className={styles.recolorPanelToggle}
              title={recolorPanelCollapsed ? '展开面板' : '收起面板'}
              onClick={() => setRecolorPanelCollapsed((v) => !v)}
            >
              {recolorPanelCollapsed ? <LeftOutlined /> : <RightOutlined />}
            </button>
            {showImageInspector && (
          <div className={styles.recolorPanel}>
            <div className={styles.recolorPanelTitle}>
              <BgColorsOutlined />
              <span>填色</span>
            </div>
            <div className={styles.recolorRow} style={{ marginBottom: 8 }}>
              <span className={styles.recolorLabel}>当前参数</span>
              <Radio.Group
                size="small"
                value={activeTool === 'redraw' ? 'redraw' : 'recolor'}
                onChange={(e) => setActiveTool(e.target.value === 'redraw' ? 'redraw' : 'recolor')}
                options={[
                  { label: '填色', value: 'recolor' },
                  { label: '重绘', value: 'redraw' },
                ]}
              />
            </div>
            <div className={styles.recolorWhiteBgBlock}>
              <div className={styles.recolorWhiteBgRow}>
                <span className={styles.recolorWhiteBgLabel}>导入白底去除</span>
                <Switch size="small" checked={bgStripEnabled} onChange={setBgStripEnabled} />
              </div>
              <div className={styles.recolorWhiteBgStrength}>
                <span className={styles.recolorWhiteBgStrengthLabel}>强度</span>
                <Slider
                  min={220}
                  max={255}
                  step={1}
                  value={bgStripThreshold}
                  onChange={(v) => setBgStripThreshold(typeof v === 'number' ? v : 246)}
                  disabled={!bgStripEnabled}
                  style={{ flex: 1, margin: 0 }}
                />
                <span className={styles.recolorWhiteBgStrengthValue}>{bgStripThreshold}</span>
              </div>
            </div>
            <div className={styles.contextActionBar}>
              {activeTool === 'recolor' && (
                <>
                  <div className={styles.contextActionGroup}>
                    <span className={styles.contextActionTitle}>填色工具</span>
                    <span style={{ fontSize: 11, color: '#8c8c8c' }}>已进入框选模式（Esc 退出）</span>
                    {recolorRegion && <Button size="small" icon={<DeleteOutlined />} onClick={clearRecolorRegion}>清除框选</Button>}
                    <Button type="primary" size="small" icon={<BgColorsOutlined />} loading={recolorApplying} onClick={applyRecolor}>应用填色</Button>
                  </div>
                  {recolorInlineError && (
                    <div style={{
                      width: '100%',
                      fontSize: 12,
                      color: '#a8071a',
                      padding: '4px 8px',
                      border: '1px solid #ffccc7',
                      borderRadius: 6,
                      background: '#fff1f0',
                    }}>
                      {recolorInlineError}
                    </div>
                  )}
                </>
              )}
              {activeTool === 'redraw' && (
                <>
                  <div className={styles.contextActionGroup}>
                    <span className={styles.contextActionTitle}>重绘工具</span>
                    <Button size="small" icon={<PictureOutlined />} loading={redrawLoading} onClick={() => contextRunRedrawRef.current?.()}>重绘预览</Button>
                    <Button size="small" icon={<CopyOutlined />} onClick={() => setRedrawCompareOpen(true)} disabled={!redrawPreviewDataUrl}>对比预览</Button>
                    <Button type="primary" size="small" icon={<ArrowDownOutlined />} onClick={() => contextApplyRedrawRef.current?.()} disabled={!redrawPreviewDataUrl}>替换画布图</Button>
                  </div>
                </>
              )}
            </div>
            {activeTool === 'recolor' && (
              <>
                <div className={`${styles.recolorSection} ${styles.recolorRow}`}>
                  <span className={styles.recolorLabel}>模式</span>
                  <Radio.Group
                    size="small"
                    value={recolorMode}
                    onChange={(e) => setRecolorMode(e.target.value)}
                    options={[
                      { label: '渐变', value: 'gradient' },
                      { label: '纯色', value: 'solid' },
                    ]}
                  />
                </div>
                <div className={styles.recolorMappingBlock}>
                  <div className={styles.recolorMappingHint}>
                    {recolorMode === 'gradient'
                      ? '每行：原图该段颜色 → 改成的新颜色（按渐变插值）'
                      : '圈选区域内的主色 → 新色（仅一行生效，白底不变）'}
                  </div>
                  {(recolorMode === 'solid' ? [0] : [0, 1, 2]).map((i) => (
                    <div key={i} className={styles.recolorMappingRow}>
                      <span className={styles.recolorStopLabel}>{recolorMode === 'gradient' ? ['低值', '中值', '高值'][i] : `颜色 ${i + 1}`}</span>
                      <span className={styles.recolorMappingFrom}>
                        <ColorPicker
                          value={toInputColor(oldList[i])}
                          disabled
                          showText={false}
                          size="small"
                          placement="rightTop"
                          getPopupContainer={() => document.body}
                          className={styles.recolorColorPicker}
                        />
                      </span>
                      <span className={styles.recolorArrow}>→</span>
                      <span className={styles.recolorMappingTo}>
                        <ColorPicker
                          value={toInputColor(newList[i])}
                          onChange={(c) => {
                            const next = [...newList]
                            next[i] = (c?.toHexString?.() ?? toInputColor(newList[i])).toUpperCase()
                            setRecolorNewColors(next)
                          }}
                          showText={false}
                          size="small"
                          placement="rightTop"
                          getPopupContainer={() => document.body}
                          className={styles.recolorColorPicker}
                        />
                        <span className={styles.recolorUseOrigSlot}>
                          {oldList[i] !== newList[i] ? (
                            <Button
                              type="link"
                              size="small"
                              className={styles.recolorUseOrig}
                              onClick={() => {
                                const next = [...newList]
                                next[i] = oldList[i]
                                setRecolorNewColors(next)
                              }}
                            >
                              沿用
                            </Button>
                          ) : (
                            <span className={styles.recolorUseOrigPlaceholder} aria-hidden>沿用</span>
                          )}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                {recolorMode === 'gradient' && (
                  <div className={styles.recolorRow}>
                    <Checkbox
                      checked={recolorOnlyNearGradient}
                      onChange={(e) => setRecolorOnlyNearGradient(e.target.checked)}
                    >
                      仅改渐变（保留文字、轴线等）
                    </Checkbox>
                  </div>
                )}
                <div className={styles.recolorMainHint}>
                  主操作已移至上方上下文条：清除框选 / 应用填色
                </div>
                {(selectedImageData?.obj as FabricType.Object & { data?: Record<string, unknown> })?.data?.recolorParams && (
                  <Button
                    size="small"
                    onClick={() => {
                      const canvas = fabricCanvasRef.current
                      const img = selectedImageData!.obj
                      const data = (img as FabricType.Object & { data?: Record<string, unknown> })?.data
                      const originalDataUrl = data?.originalDataUrl
                      if (!canvas || !originalDataUrl) return
                      const left = img.left ?? 0
                      const top = img.top ?? 0
                      const scaleX = img.scaleX ?? 1
                      const scaleY = img.scaleY ?? 1
                      ;(img as FabricType.Object & { setSrc: (u: string, cb: (o: FabricType.Object) => void) => void }).setSrc(originalDataUrl, (updated: FabricType.Object) => {
                        updated.set({ left, top, scaleX, scaleY })
                        updated.set('data', { ...data, originalDataUrl })
                        canvas.requestRenderAll()
                      })
                    }}
                    block
                    style={{ marginTop: 4 }}
                  >
                    移除填色
                  </Button>
                )}
              </>
            )}
            {activeTool === 'redraw' && selectedImageData && (() => {
              const data = (selectedImageData.obj as FabricType.Object & { data?: Record<string, unknown> }).data
              const hasSource = Boolean(data?.outputDir && data?.sourceFunctionName)
              const outputDir = (data?.outputDir as string) || manualOutputDir
              const rdsFile = ((data?.rdsFile as string) || manualRdsFile) || 'heatmap.rds'
              const effectiveConfig = redrawConfig
                ?? (selectedManualRedrawKey ? redrawMethodOptions.find((o) => o.key === selectedManualRedrawKey) : null)
                ?? (selectedManualRedrawKey ? (() => {
                  const [redrawFunctionName, packageName] = selectedManualRedrawKey.split('::')
                  return redrawFunctionName && packageName
                    ? { redrawFunctionName, packageName, sourceName: '', key: selectedManualRedrawKey, redrawParameters: undefined as RedrawParameterDef[] | undefined }
                    : null
                })() : null)
              const hasRedrawParam = (name: string) => {
                const names = effectiveConfig?.redrawParameters?.map((p) => p.name).filter(Boolean)
                // 向后兼容：未配置 redrawParameters 时默认全量展示
                if (!names || names.length === 0) return true
                return names.includes(name)
              }
              const redrawApi = (window.electronAPI as { redrawFromRds?: (opts: {
                outputDir: string
                redrawFunctionName: string
                packageName?: string
                rdsFile?: string
                palette?: string[]
                annotation_colors_list?: string
                fontsize?: number
                width?: number
                height?: number
                image_format?: string
                dpi?: number
              }) => Promise<{ success: boolean; imagePath?: string; error?: string; assembledCall?: string }> }).redrawFromRds
              const buildAnnotationColorsR = () => {
                const datasetNames = redrawDatasetNamesList.filter(Boolean)
                const ctrlHex = redrawAnnotationGroupControl || REDRAW_ANNOTATION_PRESET_COLORS[0]
                const disHex = redrawAnnotationGroupDisease || REDRAW_ANNOTATION_PRESET_COLORS[1]
                const groupPart = `Group=c("Control"="${ctrlHex.replace(/"/g, '\\"')}", "Disease"="${disHex.replace(/"/g, '\\"')}")`
                const datasetPart = datasetNames.length > 0
                  ? `DataSet=c(${datasetNames.map((n, i) => {
                      const hex = redrawAnnotationDataset[n] || REDRAW_ANNOTATION_PRESET_COLORS[i % REDRAW_ANNOTATION_PRESET_COLORS.length]
                      return `"${n.replace(/"/g, '\\"')}"="${hex.replace(/"/g, '\\"')}"`
                    }).join(', ')})`
                  : ''
                const parts = [groupPart]
                if (datasetPart) parts.push(datasetPart)
                return `list(${parts.join(', ')})`
              }
              const runRedraw = async () => {
                if (!hasSource) {
                  if (!effectiveConfig) {
                    message.error('请先选择重绘方法')
                    return
                  }
                  if (!outputDir?.trim()) {
                    message.error('请选择 RDS 所在目录')
                    return
                  }
                }
                if (!redrawApi) {
                  message.error('重绘功能不可用')
                  return
                }
                if (!effectiveConfig) {
                  message.error('请先选择重绘方法')
                  return
                }
                if (!outputDir?.trim()) {
                  message.error('请选择 RDS 所在目录')
                  return
                }
                setRedrawLoading(true)
                setRedrawPreviewDataUrl(null)
                setRedrawAssembledCall('')
                try {
                  const redrawPayload: {
                    outputDir: string
                    redrawFunctionName: string
                    packageName?: string
                    rdsFile?: string
                    palette?: string[]
                    annotation_colors_list?: string
                    fontsize?: number
                    width?: number
                    height?: number
                    show_gene_names?: boolean
                    image_format?: string
                    dpi?: number
                  } = {
                    outputDir,
                    redrawFunctionName: effectiveConfig.redrawFunctionName,
                    packageName: effectiveConfig.packageName,
                    rdsFile,
                  }
                  if (hasRedrawParam('palette')) redrawPayload.palette = redrawPalette.slice(0, 3)
                  if (hasRedrawParam('annotation_colors_list')) redrawPayload.annotation_colors_list = buildAnnotationColorsR()
                  if (hasRedrawParam('fontsize')) redrawPayload.fontsize = redrawFontSize
                  if (hasRedrawParam('width')) redrawPayload.width = redrawWidth
                  if (hasRedrawParam('height')) redrawPayload.height = redrawHeight
                  if (hasRedrawParam('show_gene_names')) redrawPayload.show_gene_names = redrawShowGeneNames
                  if (hasRedrawParam('image_format')) redrawPayload.image_format = redrawImageFormat
                  if (hasRedrawParam('dpi')) redrawPayload.dpi = redrawDpi
                  for (const [k, v] of Object.entries(redrawExtraParams)) {
                    if (!hasRedrawParam(k)) continue
                    ;(redrawPayload as Record<string, unknown>)[k] = v
                  }
                  const res = await redrawApi(redrawPayload)
                  if (res.success && res.imagePath) {
                    if (res.assembledCall) setRedrawAssembledCall(res.assembledCall)
                    const imgRes = await window.electronAPI.readImageAsDataUrl(res.imagePath)
                    if (imgRes.success && imgRes.dataUrl) setRedrawPreviewDataUrl(imgRes.dataUrl)
                    else message.error('预览图加载失败')
                  } else {
                    if (res.assembledCall) setRedrawAssembledCall(res.assembledCall)
                    message.error(res.error || '重绘失败')
                  }
                } catch (e) {
                  message.error(e instanceof Error ? e.message : '重绘失败')
                } finally {
                  setRedrawLoading(false)
                }
              }
              const applyRedrawPreviewToCanvas = () => {
                const canvas = fabricCanvasRef.current
                const img = selectedImageData.obj
                if (!canvas || !img || !redrawPreviewDataUrl) return
                const left = img.left ?? 0
                const top = img.top ?? 0
                const scaleX = img.scaleX ?? 1
                const scaleY = img.scaleY ?? 1
                const imgData = (img as FabricType.Object & { data?: Record<string, unknown> }).data
                ;(img as FabricType.Object & { setSrc: (u: string, cb: (o: FabricType.Object) => void) => void }).setSrc(redrawPreviewDataUrl, (updated: FabricType.Object) => {
                  updated.set({ left, top, scaleX, scaleY })
                  updated.set('data', { ...imgData, originalDataUrl: redrawPreviewDataUrl })
                  canvas.requestRenderAll()
                  message.success('已用重绘结果替换当前图')
                })
              }
              contextRunRedrawRef.current = () => { void runRedraw() }
              contextApplyRedrawRef.current = applyRedrawPreviewToCanvas
              const sourceParams = data?.sourceParams as Record<string, unknown> | undefined
              const oldDisplay = sourceParams
                ? (() => {
                    const ann = parseAnnotationColors(sourceParams)
                    const dsListRaw = Array.isArray(sourceParams.annotation_dataset_levels)
                      ? (sourceParams.annotation_dataset_levels as string[])
                      : (Array.isArray(sourceParams.annotation_dataset_list) ? (sourceParams.annotation_dataset_list as string[]) : [])
                    const dsObj = Object.keys(ann.datasetMap).length > 0
                      ? ann.datasetMap
                      : ((sourceParams.annotation_dataset as Record<string, unknown>) || {})
                    const dsList = dsListRaw.length > 0 ? dsListRaw : Object.keys(dsObj)
                    return {
                      palette: Array.isArray(sourceParams.palette)
                        ? (sourceParams.palette as unknown[]).slice(0, 3).map((c) => toHexColor(c))
                        : (typeof sourceParams.palette === 'string' ? [toHexColor(sourceParams.palette)] : []),
                      fontsize: sourceParams.fontsize != null ? String(sourceParams.fontsize) : '-',
                      width: sourceParams.width != null ? String(sourceParams.width) : '-',
                      height: sourceParams.height != null ? String(sourceParams.height) : '-',
                      show_gene_names: sourceParams.show_gene_names != null ? String(sourceParams.show_gene_names) : '-',
                      image_format: sourceParams.image_format != null ? String(sourceParams.image_format) : '-',
                      dpi: sourceParams.dpi != null ? String(sourceParams.dpi) : '-',
                      control: ann.control,
                      disease: ann.disease,
                      datasetList: dsList,
                      datasetMap: Object.fromEntries(Object.entries(dsObj).map(([k, v]) => [k, toHexColor(v)])),
                      extraValues: sourceParams,
                    }
                  })()
                : null
              const builtinParamNames = ['palette', 'fontsize', 'width', 'height', 'show_gene_names', 'image_format', 'dpi', 'annotation_colors_list'] as const
              const builtinLabelMap: Record<string, string> = {
                fontsize: '字号',
                width: '宽',
                height: '高',
                show_gene_names: '基因名',
                image_format: '格式',
                dpi: 'DPI',
              }
              const builtinTypeMap: Record<string, RedrawParameterDef['type']> = {
                fontsize: 'number',
                width: 'number',
                height: 'number',
                show_gene_names: 'boolean',
                image_format: 'select',
                dpi: 'number',
              }
              const cfgDefs = effectiveConfig?.redrawParameters || []
              const builtinDefs: RedrawParameterDef[] = builtinParamNames
                .filter((n) => hasRedrawParam(n))
                .map((n) => cfgDefs.find((d) => d.name === n) || { name: n, type: builtinTypeMap[n] })
              const extraDefs: RedrawParameterDef[] = cfgDefs.filter((p) => {
                const n = p.name
                return Boolean(n) && !builtinParamNames.includes(n as (typeof builtinParamNames)[number]) && !['rds_file', 'out_file'].includes(n) && hasRedrawParam(n)
              })
              const renderPaletteControl = (showLevelLabel: boolean) => (
                <Space size={showLevelLabel ? 'small' : 4} wrap>
                  {[0, 1, 2].map((i) => (
                    <Space key={i} align="center" size={showLevelLabel ? 4 : 0}>
                      {showLevelLabel && <span style={{ fontSize: 11, color: '#999' }}>{['低', '中', '高'][i]}</span>}
                      <ColorPicker
                        value={redrawPalette[i] || ['#0000FF', '#FFFFFF', '#FF0000'][i]}
                        onChange={(c) => {
                          const next = [...redrawPalette]
                          while (next.length <= i) next.push('#cccccc')
                          next[i] = c?.toHexString?.() ?? next[i]
                          setRedrawPalette(next)
                        }}
                        showText
                        size="small"
                        getPopupContainer={(triggerNode) => triggerNode?.parentElement || triggerNode}
                      />
                    </Space>
                  ))}
                  <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }} onClick={() => setRedrawPalette([newList[0] ?? '#0000FF', newList[1] ?? '#FFFFFF', newList[2] ?? '#FF0000'])}>沿用填色</Button>
                </Space>
              )
              const renderParamByDef = (def: RedrawParameterDef, mode: 'oldCompare' | 'newCompare' | 'newSimple') => {
                const name = def.name
                if (!name || !hasRedrawParam(name)) return null
                if (name === 'palette') {
                  if (mode === 'oldCompare') {
                    return (
                      <div key={name} style={{ marginBottom: 6 }}>
                        <span style={{ color: '#666', fontSize: 11 }}>颜色 </span>
                        <Space size={4} wrap>
                          {[0, 1, 2].map((i) => (
                            <ColorPicker
                              key={i}
                              value={oldDisplay?.palette[i] || ['#0000FF', '#FFFFFF', '#FF0000'][i]}
                              disabled
                              showText
                              size="small"
                              getPopupContainer={(triggerNode) => triggerNode?.parentElement || triggerNode}
                            />
                          ))}
                        </Space>
                      </div>
                    )
                  }
                  if (mode === 'newCompare') {
                    return (
                      <div key={name} style={{ marginBottom: 6 }}>
                        <span style={{ color: '#666', fontSize: 11 }}>颜色 </span>
                        {renderPaletteControl(false)}
                      </div>
                    )
                  }
                  return (
                    <div key={name} className={styles.recolorRow}>
                      <span className={styles.recolorLabel}>颜色</span>
                      {renderPaletteControl(true)}
                    </div>
                  )
                }
                if (name === 'annotation_colors_list') {
                  if (mode === 'oldCompare') {
                    return (
                      <div key={name} style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #eee' }}>
                        <span style={{ color: '#666', fontSize: 11 }}>注释颜色 </span>
                        <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 4 }}>
                          {([
                            { label: 'Control', value: oldDisplay?.control || '#000000' },
                            { label: 'Disease', value: oldDisplay?.disease || '#000000' },
                          ] as const).map((item) => (
                            <Space key={item.label} align="center" size={6} wrap>
                              <span style={{ fontSize: 11, color: '#666', minWidth: 52 }}>{item.label}</span>
                              <ColorPicker
                                value={item.value}
                                disabled
                                showText
                                size="small"
                                getPopupContainer={(triggerNode) => triggerNode?.parentElement || triggerNode}
                              />
                            </Space>
                          ))}
                          <div style={{ marginTop: 4 }}>
                            <span style={{ fontSize: 11, color: '#666' }}>DataSet </span>
                            <Select
                              mode="tags"
                              size="small"
                              value={oldDisplay?.datasetList || []}
                              open={false}
                              disabled
                              style={{ width: '100%', marginTop: 2 }}
                              tagRender={({ value }) => (
                                <Tag color="default" style={{ marginRight: 2, fontSize: 11 }}>{value}</Tag>
                              )}
                            />
                            {(oldDisplay?.datasetList || []).map((ds) => (
                              <Space key={ds} align="center" size={4} wrap style={{ marginTop: 4 }}>
                                <span style={{ fontSize: 11, color: '#666', minWidth: 40 }}>{ds}</span>
                                <ColorPicker
                                  value={oldDisplay?.datasetMap[ds] || '#000000'}
                                  disabled
                                  showText
                                  size="small"
                                  getPopupContainer={(triggerNode) => triggerNode?.parentElement || triggerNode}
                                />
                              </Space>
                            ))}
                          </div>
                        </Space>
                      </div>
                    )
                  }
                  const isSimple = mode === 'newSimple'
                  const paletteChoices = mode === 'newCompare' ? REDRAW_ANNOTATION_PRESET_COLORS.slice(0, 6) : REDRAW_ANNOTATION_PRESET_COLORS
                  const chipSize = mode === 'newCompare' ? 20 : REDRAW_ANNOTATION_CHIP_SIZE
                  const labelMinWidth = mode === 'newCompare' ? 52 : 56
                  return (
                    <div key={name} style={mode === 'newCompare' ? { marginTop: 8, paddingTop: 6, borderTop: '1px solid #d6e4ff' } : undefined}>
                      <span style={{ color: '#666', fontSize: 11 }}>{isSimple ? '注释颜色（可点色块）' : '注释颜色'} </span>
                      <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 4 }}>
                        {(['Control', 'Disease'] as const).map((label, idx) => {
                          const val = label === 'Control' ? redrawAnnotationGroupControl : redrawAnnotationGroupDisease
                          const setVal = label === 'Control' ? setRedrawAnnotationGroupControl : setRedrawAnnotationGroupDisease
                          const displayHex = val || REDRAW_ANNOTATION_PRESET_COLORS[idx]
                          return (
                            <Space key={label} align="center" size={6} wrap>
                              <span style={{ fontSize: 11, color: '#666', minWidth: labelMinWidth }}>{label}</span>
                              {paletteChoices.map((hex) => {
                                const chip = (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setVal(hex)}
                                    onKeyDown={(e) => e.key === 'Enter' && setVal(hex)}
                                    style={{
                                      width: chipSize,
                                      height: chipSize,
                                      borderRadius: mode === 'newCompare' ? 4 : 6,
                                      backgroundColor: hex,
                                      border: displayHex.toLowerCase() === hex.toLowerCase() ? '2px solid #1890ff' : '1px solid #d9d9d9',
                                      cursor: 'pointer',
                                    }}
                                  />
                                )
                                return isSimple ? (
                                  <Tooltip
                                    key={hex}
                                    title={
                                      <span
                                        style={{
                                          display: 'inline-block',
                                          width: 56,
                                          height: 56,
                                          backgroundColor: hex,
                                          borderRadius: 8,
                                          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                        }}
                                      />
                                    }
                                  >
                                    {chip}
                                  </Tooltip>
                                ) : (
                                  <Tooltip key={hex} title={<span style={{ display: 'inline-block', width: 24, height: 24, backgroundColor: hex, borderRadius: 4 }} />}>
                                    {chip}
                                  </Tooltip>
                                )
                              })}
                              <ColorPicker
                                value={displayHex}
                                onChange={(c) => setVal(c?.toHexString?.() ?? displayHex)}
                                showText
                                size="small"
                                getPopupContainer={(triggerNode) => triggerNode?.parentElement || triggerNode}
                              />
                            </Space>
                          )
                        })}
                        <div style={{ marginTop: isSimple ? 6 : 4 }}>
                          <span style={{ fontSize: 11, color: '#666' }}>{isSimple ? 'DataSet（按样本名）' : 'DataSet'} </span>
                          <Select
                            mode="tags"
                            size="small"
                            placeholder={isSimple ? '输入样本名称后回车添加，如 GSE123456' : '样本名'}
                            value={redrawDatasetNamesList}
                            onChange={(v) => setRedrawDatasetNamesList(Array.isArray(v) ? v : [])}
                            tokenSeparators={[',']}
                            style={{ width: '100%', marginTop: isSimple ? 4 : 2 }}
                            tagRender={({ value, closable, onClose }) => (
                              <Tag color="blue" closable={closable} onClose={onClose} style={{ marginRight: isSimple ? 4 : 2, fontSize: isSimple ? undefined : 11 }}>{value}</Tag>
                            )}
                          />
                          {redrawDatasetNamesList.map((ds, i) => {
                            const displayHex = redrawAnnotationDataset[ds] || REDRAW_ANNOTATION_PRESET_COLORS[i % REDRAW_ANNOTATION_PRESET_COLORS.length]
                            return (
                              <Space key={ds} align="center" size={isSimple ? 6 : 4} wrap style={{ marginTop: isSimple ? 6 : 4 }}>
                                <span style={{ fontSize: 11, color: '#666', minWidth: labelMinWidth }}>{ds}</span>
                                {paletteChoices.map((hex) => {
                                  const chip = (
                                    <span
                                      key={hex}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => setRedrawAnnotationDataset((prev) => ({ ...prev, [ds]: hex }))}
                                      onKeyDown={(e) => e.key === 'Enter' && setRedrawAnnotationDataset((prev) => ({ ...prev, [ds]: hex }))}
                                      style={{
                                        width: chipSize,
                                        height: chipSize,
                                        borderRadius: mode === 'newCompare' ? 4 : 6,
                                        backgroundColor: hex,
                                        border: displayHex.toLowerCase() === hex.toLowerCase() ? '2px solid #1890ff' : '1px solid #d9d9d9',
                                        cursor: 'pointer',
                                      }}
                                    />
                                  )
                                  if (!isSimple) return chip
                                  return (
                                    <Tooltip
                                      key={hex}
                                      title={
                                        <span
                                          style={{
                                            display: 'inline-block',
                                            width: 56,
                                            height: 56,
                                            backgroundColor: hex,
                                            borderRadius: 8,
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                          }}
                                        />
                                      }
                                    >
                                      {chip}
                                    </Tooltip>
                                  )
                                })}
                                <ColorPicker
                                  value={displayHex}
                                  onChange={(c) => setRedrawAnnotationDataset((prev) => ({ ...prev, [ds]: c?.toHexString?.() ?? displayHex }))}
                                  showText
                                  size="small"
                                  getPopupContainer={(triggerNode) => triggerNode?.parentElement || triggerNode}
                                />
                              </Space>
                            )
                          })}
                        </div>
                      </Space>
                    </div>
                  )
                }
                const val = redrawExtraParams[name]
                if (name === 'show_gene_names') {
                  if (mode === 'oldCompare') {
                    return (
                      <div key={name} style={{ marginBottom: 4 }}>
                        <span style={{ color: '#666', fontSize: 11 }}>{builtinLabelMap[name]} </span>
                        <Checkbox checked={String(oldDisplay?.show_gene_names ?? '').toLowerCase() === 'true'} disabled />
                      </div>
                    )
                  }
                  const content = <Checkbox checked={redrawShowGeneNames} onChange={(e) => setRedrawShowGeneNames(e.target.checked)} />
                  return mode === 'newSimple'
                    ? <div key={name} className={styles.recolorRow}><span className={styles.recolorLabel}>{builtinLabelMap[name]}</span>{content}</div>
                    : <div key={name} style={{ marginBottom: 4 }}><span style={{ color: '#666', fontSize: 11 }}>{builtinLabelMap[name]} </span>{content}</div>
                }
                if (name === 'image_format') {
                  if (mode === 'oldCompare') {
                    return (
                      <div key={name} style={{ marginBottom: 4 }}>
                        <span style={{ color: '#666', fontSize: 11 }}>{builtinLabelMap[name]} </span>
                        <Input size="small" value={String(oldDisplay?.image_format ?? '-')} readOnly style={{ width: 90 }} />
                      </div>
                    )
                  }
                  const content = (
                    <Select
                      size="small"
                      style={{ width: mode === 'newSimple' ? 100 : 90 }}
                      value={redrawImageFormat}
                      onChange={(v) => setRedrawImageFormat(v)}
                      options={[{ label: 'png', value: 'png' }, { label: 'pdf', value: 'pdf' }]}
                    />
                  )
                  return mode === 'newSimple'
                    ? <div key={name} className={styles.recolorRow}><span className={styles.recolorLabel}>{builtinLabelMap[name]}</span>{content}</div>
                    : <div key={name} style={{ marginBottom: 4 }}><span style={{ color: '#666', fontSize: 11 }}>{builtinLabelMap[name]} </span>{content}</div>
                }
                if (name === 'fontsize' || name === 'width' || name === 'height' || name === 'dpi') {
                  if (mode === 'oldCompare') {
                    const oldRaw = oldDisplay?.[name as 'fontsize' | 'width' | 'height' | 'dpi']
                    const oldNum = Number(oldRaw)
                    return (
                      <div key={name} style={{ marginBottom: 4 }}>
                        <span style={{ color: '#666', fontSize: 11 }}>{builtinLabelMap[name]} </span>
                        {Number.isFinite(oldNum)
                          ? <InputNumber value={oldNum} size="small" style={{ width: 72 }} disabled />
                          : <Input size="small" value="-" readOnly style={{ width: 72 }} />}
                      </div>
                    )
                  }
                  const content = (
                    <InputNumber
                      min={name === 'fontsize' ? 8 : name === 'dpi' ? 72 : 4}
                      max={name === 'fontsize' ? 24 : name === 'dpi' ? 1200 : 24}
                      value={
                        name === 'fontsize' ? redrawFontSize :
                        name === 'width' ? redrawWidth :
                        name === 'height' ? redrawHeight :
                        redrawDpi
                      }
                      onChange={(v) => {
                        const num = typeof v === 'number' ? v : (name === 'dpi' ? 150 : name === 'fontsize' ? 12 : undefined)
                        if (name === 'fontsize') setRedrawFontSize((num as number) ?? 12)
                        else if (name === 'width') setRedrawWidth(num as number | undefined)
                        else if (name === 'height') setRedrawHeight(num as number | undefined)
                        else setRedrawDpi((num as number) ?? 150)
                      }}
                      size="small"
                      placeholder={name === 'width' || name === 'height' ? '英寸' : undefined}
                      style={{ width: mode === 'newSimple' ? 88 : 72 }}
                    />
                  )
                  return mode === 'newSimple'
                    ? <div key={name} className={styles.recolorRow}><span className={styles.recolorLabel}>{builtinLabelMap[name]}</span>{content}</div>
                    : <div key={name} style={{ marginBottom: 4 }}><span style={{ color: '#666', fontSize: 11 }}>{builtinLabelMap[name]} </span>{content}</div>
                }
                if (mode === 'oldCompare') {
                  return (
                    <div key={name} style={{ marginBottom: 4 }}>
                      <span style={{ color: '#666', fontSize: 11 }}>{name} </span>
                      <span style={{ fontSize: 11, color: '#333', wordBreak: 'break-all' }}>
                        {oldDisplay?.extraValues?.[name] == null ? '-' : String(oldDisplay.extraValues[name])}
                      </span>
                    </div>
                  )
                }
                if (def.type === 'number') {
                  return (
                    <div key={name} className={styles.recolorRow}>
                      <span className={styles.recolorLabel}>{name}</span>
                      <InputNumber
                        size="small"
                        style={{ width: 120 }}
                        min={def.min}
                        max={def.max}
                        value={typeof val === 'number' ? val : Number(val)}
                        onChange={(v) => setRedrawExtraParams((prev) => ({ ...prev, [name]: typeof v === 'number' ? v : undefined }))}
                      />
                    </div>
                  )
                }
                if (def.type === 'boolean') {
                  return (
                    <div key={name} className={styles.recolorRow}>
                      <span className={styles.recolorLabel}>{name}</span>
                      <Checkbox
                        checked={Boolean(val)}
                        onChange={(e) => setRedrawExtraParams((prev) => ({ ...prev, [name]: e.target.checked }))}
                      />
                    </div>
                  )
                }
                if (def.type === 'select' && Array.isArray(def.options) && def.options.length > 0) {
                  return (
                    <div key={name} className={styles.recolorRow}>
                      <span className={styles.recolorLabel}>{name}</span>
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={typeof val === 'string' ? val : undefined}
                        options={def.options.map((o) => ({ label: o, value: o }))}
                        onChange={(v) => setRedrawExtraParams((prev) => ({ ...prev, [name]: v }))}
                      />
                    </div>
                  )
                }
                return (
                  <div key={name} className={styles.recolorRow}>
                    <span className={styles.recolorLabel}>{name}</span>
                    <Input
                      size="small"
                      value={val == null ? '' : String(val)}
                      placeholder={def.placeholder}
                      onChange={(e) => setRedrawExtraParams((prev) => ({ ...prev, [name]: e.target.value }))}
                    />
                  </div>
                )
              }
              return (
                <>
                  <div className={styles.recolorRow} style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #eee' }}>
                    <span className={styles.recolorLabel}>从 RDS 重绘</span>
                  </div>
                  {hasSource ? (
                    <>
                      <div className={styles.recolorRow}>
                        <span className={styles.recolorLabel}>重绘方法</span>
                        <Input
                          size="small"
                          readOnly
                          value={effectiveConfig ? `${effectiveConfig.redrawFunctionName} (${effectiveConfig.packageName})` : '-'}
                          style={{ color: '#666', backgroundColor: '#fafafa' }}
                        />
                      </div>
                      <div className={styles.recolorRow}>
                        <span className={styles.recolorLabel}>RDS 路径</span>
                        <Input
                          size="small"
                          readOnly
                          value={outputDir ? `${outputDir.replace(/[/\\]+$/, '')}/${rdsFile}` : '-'}
                          style={{ color: '#666', backgroundColor: '#fafafa' }}
                          title={outputDir ? `${outputDir.replace(/[/\\]+$/, '')}/${rdsFile}` : undefined}
                        />
                      </div>
                    </>
                  ) : null}
                  {!hasSource && (
                    <>
                      <div className={styles.recolorRow}>
                        <span className={styles.recolorLabel}>重绘方法</span>
                        <Select
                          size="small"
                          style={{ width: '100%' }}
                          placeholder="选择方法"
                          value={selectedManualRedrawKey || undefined}
                          options={redrawMethodOptions.map((o) => ({ label: o.sourceName, value: o.key }))}
                          onChange={setSelectedManualRedrawKey}
                        />
                      </div>
                      <div className={styles.recolorRow}>
                        <span className={styles.recolorLabel}>RDS 目录</span>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <Button
                            size="small"
                            icon={<FolderOpenOutlined />}
                            onClick={async () => {
                              const path = await window.electronAPI.selectDirectory?.()
                              if (path) setManualOutputDir(path)
                            }}
                          >
                            选择
                          </Button>
                          <span className={styles.recolorLabel} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={manualOutputDir}>
                            {manualOutputDir || '未选择'}
                          </span>
                        </div>
                      </div>
                      <div className={styles.recolorRow}>
                        <span className={styles.recolorLabel}>RDS 文件名</span>
                        <Input
                          size="small"
                          value={manualRdsFile}
                          onChange={(e) => setManualRdsFile(e.target.value)}
                          placeholder="heatmap.rds"
                          style={{ width: '100%' }}
                        />
                      </div>
                    </>
                  )}
                  {oldDisplay && (
                    <div className={styles.recolorRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                      <span className={styles.recolorLabel}>参数对比（颜色、字号、宽高、注释颜色）</span>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12 }}>
                        <div style={{ flex: 1, minWidth: 0, padding: 8, background: '#fafafa', borderRadius: 6, border: '1px solid #eee' }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#666', fontSize: 11 }}>旧参数（不可改）</div>
                          {builtinDefs.map((d) => renderParamByDef(d, 'oldCompare'))}
                          {extraDefs.length > 0 && (
                            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #eee' }}>
                              {extraDefs.map((d) => renderParamByDef(d, 'oldCompare'))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', color: '#1890ff', fontWeight: 600, paddingTop: 20 }}>⇒</div>
                        <div style={{ flex: 1, minWidth: 0, padding: 8, background: '#f0f7ff', borderRadius: 6, border: '1px solid #d6e4ff' }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#1890ff', fontSize: 11 }}>新参数（可调）</div>
                          {builtinDefs.map((d) => renderParamByDef(d, 'newCompare'))}
                        </div>
                      </div>
                      <Button
                        size="small"
                        onClick={() => {
                          const img = selectedImageData.obj as FabricType.Object & { data?: Record<string, unknown> }
                          const prevData = img.data || {}
                          const nextSourceParams = {
                            ...(typeof prevData.sourceParams === 'object' && prevData.sourceParams !== null ? prevData.sourceParams as Record<string, unknown> : {}),
                            palette: redrawPalette.slice(0, 3),
                            fontsize: redrawFontSize,
                            width: redrawWidth,
                            height: redrawHeight,
                            show_gene_names: redrawShowGeneNames,
                            image_format: redrawImageFormat,
                            dpi: redrawDpi,
                            annotation_control: redrawAnnotationGroupControl || REDRAW_ANNOTATION_PRESET_COLORS[0],
                            annotation_disease: redrawAnnotationGroupDisease || REDRAW_ANNOTATION_PRESET_COLORS[1],
                            annotation_dataset_list: redrawDatasetNamesList,
                            annotation_dataset: { ...redrawAnnotationDataset },
                            ...redrawExtraParams,
                          }
                          img.set('data', { ...prevData, sourceParams: nextSourceParams })
                          setSelectedImageData((prev) => (prev ? { ...prev, obj: prev.obj } : null))
                          message.success('已用当前新参数更新旧参数')
                        }}
                      >
                        替换（将新参数定为旧参数）
                      </Button>
                    </div>
                  )}
                  {!oldDisplay && (
                    <>
                      {builtinDefs.map((d) => d.name === 'annotation_colors_list' ? null : renderParamByDef(d, 'newSimple'))}
                    </>
                  )}
                  {!oldDisplay && builtinDefs.some((d) => d.name === 'annotation_colors_list') && renderParamByDef({ name: 'annotation_colors_list' }, 'newSimple')}
                  {extraDefs.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed #d9d9d9' }}>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>额外重绘参数（配置驱动）</div>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {extraDefs.map((d) => renderParamByDef(d, 'newSimple'))}
                      </Space>
                    </div>
                  )}
                  <div style={{ marginTop: 4, fontSize: 11, color: '#8c8c8c' }}>
                    主操作已移至上方上下文条：重绘预览 / 对比预览 / 替换画布图
                  </div>
                  {redrawAssembledCall && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>本次组装调用</div>
                      <Input.TextArea value={redrawAssembledCall} readOnly autoSize={{ minRows: 2, maxRows: 6 }} />
                    </div>
                  )}
                  {redrawPreviewDataUrl && (
                    <div className={styles.redrawPreviewWrap}>
                      <Image
                        src={redrawPreviewDataUrl}
                        alt="重绘预览"
                        className={styles.redrawPreviewImg}
                        preview={{ mask: '点击预览大图' }}
                      />
                    </div>
                  )}
                </>
              )
            })()}
            <Modal
              title="重绘对比预览"
              open={redrawCompareOpen}
              onCancel={() => setRedrawCompareOpen(false)}
              footer={null}
              width="80vw"
            >
              <div className={styles.redrawCompareToolbar}>
                <Radio.Group
                  size="small"
                  value={redrawCompareMode}
                  onChange={(e) => setRedrawCompareMode(e.target.value)}
                  options={[
                    { label: '左右并排', value: 'sideBySide' },
                    { label: '拖拽分割', value: 'slider' },
                  ]}
                />
                <Button size="small" onClick={() => setRedrawCompareSwap((v) => !v)}>交换左右</Button>
              </div>
              {redrawCompareMode === 'sideBySide' ? (
                <div className={styles.redrawCompareWrap}>
                  <div className={styles.redrawCompareCol}>
                    <div className={styles.redrawCompareTitle}>{redrawCompareSwap ? '重绘图' : '原图'}</div>
                    <Image
                      src={redrawCompareSwap ? (redrawPreviewDataUrl || '') : (selectedImageData?.originalDataUrl || '')}
                      alt={redrawCompareSwap ? '重绘图' : '原图'}
                      preview={false}
                      className={styles.redrawCompareImg}
                    />
                  </div>
                  <div className={styles.redrawCompareCol}>
                    <div className={styles.redrawCompareTitle}>{redrawCompareSwap ? '原图' : '重绘图'}</div>
                    <Image
                      src={redrawCompareSwap ? (selectedImageData?.originalDataUrl || '') : (redrawPreviewDataUrl || '')}
                      alt={redrawCompareSwap ? '原图' : '重绘图'}
                      preview={false}
                      className={styles.redrawCompareImg}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <div className={styles.redrawCompareSliderLegend}>
                    <span>{redrawCompareSwap ? '重绘图' : '原图'}</span>
                    <InputNumber
                      min={0}
                      max={100}
                      value={redrawComparePos}
                      onChange={(v) => {
                        const next = typeof v === 'number' ? v : 50
                        const rounded = Math.round(next * 100) / 100
                        setRedrawComparePos(Math.max(0, Math.min(100, rounded)))
                      }}
                      step={0.01}
                      precision={2}
                      size="small"
                      style={{ width: 96 }}
                    />
                    <span>{redrawCompareSwap ? '原图' : '重绘图'}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={redrawComparePos}
                    onChange={(e) => setRedrawComparePos(Number(e.target.value))}
                    className={styles.redrawCompareSliderInput}
                  />
                  <div className={styles.redrawCompareSliderWrap}>
                    <img
                      src={redrawCompareSwap ? (redrawPreviewDataUrl || '') : (selectedImageData?.originalDataUrl || '')}
                      alt={redrawCompareSwap ? '重绘图' : '原图'}
                      className={styles.redrawCompareSliderBase}
                    />
                    <div
                      className={styles.redrawCompareSliderOverlay}
                      style={{ clipPath: `inset(0 ${100 - redrawComparePos}% 0 0)` }}
                    >
                      <img
                        src={redrawCompareSwap ? (selectedImageData?.originalDataUrl || '') : (redrawPreviewDataUrl || '')}
                        alt={redrawCompareSwap ? '原图' : '重绘图'}
                        className={styles.redrawCompareSliderOverlayImg}
                      />
                    </div>
                    <div
                      className={styles.redrawCompareDivider}
                      style={{ left: `${redrawComparePos}%` }}
                    />
                    <div
                      className={styles.redrawCompareHitArea}
                      onMouseDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const p = ((e.clientX - rect.left) / rect.width) * 100
                        setRedrawComparePos(Math.max(0, Math.min(100, p)))
                      }}
                      onMouseMove={(e) => {
                        if (e.buttons !== 1) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const p = ((e.clientX - rect.left) / rect.width) * 100
                        setRedrawComparePos(Math.max(0, Math.min(100, p)))
                      }}
                    />
                  </div>
                </div>
              )}
            </Modal>
          </div>
        )}
        {selectedObject && (() => {
          const t = selectedObject as FabricType.Object & {
            type?: string
            fontSize?: number
            fill?: string
            text?: string
            underline?: boolean
            linethrough?: boolean
            overline?: boolean
            lineHeight?: number
            charSpacing?: number
          }
          const isText = t.type === 'i-text' || t.type === 'textbox' || t.type === 'text'
          if (!isText) return null
          const canvas = fabricCanvasRef.current
          const content = typeof t.text === 'string' ? t.text : ''
          const hasCjk = /[\u3400-\u9FFF]/.test(content)
          const likelyLatinOnly = ['Times New Roman', 'Arial', 'Georgia', 'Courier New', 'Verdana', 'Tahoma'].includes(textFontFamily)
          return (
            <div className={styles.recolorPanel}>
              <div className={styles.recolorPanelTitle}>
                <FontSizeOutlined />
                <span>文本</span>
              </div>
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel}>字号</span>
                <InputNumber
                  min={8}
                  max={200}
                  value={textFontSize}
                  onChange={(v) => {
                    const val = typeof v === 'number' ? v : 24
                    setTextFontSize(val)
                    if (canvas && t) {
                      (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('fontSize', val)
                      canvas.requestRenderAll()
                    }
                  }}
                  size="small"
                  style={{ width: 80 }}
                />
              </div>
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel}>颜色</span>
                <ColorPicker
                  value={textFill}
                  onChange={(c) => {
                    const hex = c?.toHexString?.() ?? textFill
                    setTextFill(hex)
                    if (canvas && t) {
                      (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('fill', hex)
                      canvas.requestRenderAll()
                    }
                  }}
                  showText
                  size="small"
                  getPopupContainer={(triggerNode) => triggerNode?.parentElement || triggerNode}
                />
              </div>
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel}>字体</span>
                <Space size={6}>
                  <Select
                    size="small"
                    value={textFontFamily}
                    style={{ minWidth: 190 }}
                    showSearch
                    optionFilterProp="label"
                    options={fontSelectOptions}
                    loading={fontLoading}
                    onChange={(v) => {
                      setTextFontFamily(v)
                      if (canvas && t) {
                        (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('fontFamily', v)
                        canvas.requestRenderAll()
                      }
                    }}
                  />
                  <Button size="small" loading={fontLoading} onClick={() => { void refreshSystemFonts(true) }}>刷新</Button>
                </Space>
              </div>
              <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: -2 }}>本机可用字体：{fontSelectOptions.length}（跨平台自动识别）</div>
              {hasCjk && likelyLatinOnly && (
                <div style={{ fontSize: 11, color: '#d46b08', marginTop: 2 }}>
                  提示：当前文本含中文，西文字体可能触发系统回退，外观变化不明显
                </div>
              )}
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel}>样式</span>
                <Space size={6}>
                  <Button
                    size="small"
                    type={textFontWeight === 'bold' ? 'primary' : 'default'}
                    onClick={() => {
                      const next = textFontWeight === 'bold' ? 'normal' : 'bold'
                      setTextFontWeight(next)
                      if (canvas && t) {
                        (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('fontWeight', next)
                        canvas.requestRenderAll()
                      }
                    }}
                  >
                    粗体
                  </Button>
                  <Button
                    size="small"
                    type={textFontStyle === 'italic' ? 'primary' : 'default'}
                    onClick={() => {
                      const next = textFontStyle === 'italic' ? 'normal' : 'italic'
                      setTextFontStyle(next)
                      if (canvas && t) {
                        (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('fontStyle', next)
                        canvas.requestRenderAll()
                      }
                    }}
                  >
                    斜体
                  </Button>
                </Space>
              </div>
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel}>文字线</span>
                <Space size={6}>
                  <Button
                    size="small"
                    type={textUnderline ? 'primary' : 'default'}
                    onClick={() => {
                      const next = !textUnderline
                      setTextUnderline(next)
                      if (canvas && t) {
                        (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('underline', next)
                        canvas.requestRenderAll()
                      }
                    }}
                  >
                    下划线
                  </Button>
                  <Button
                    size="small"
                    type={textLinethrough ? 'primary' : 'default'}
                    onClick={() => {
                      const next = !textLinethrough
                      setTextLinethrough(next)
                      if (canvas && t) {
                        (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('linethrough', next)
                        canvas.requestRenderAll()
                      }
                    }}
                  >
                    中划线
                  </Button>
                  <Button
                    size="small"
                    type={textOverline ? 'primary' : 'default'}
                    onClick={() => {
                      const next = !textOverline
                      setTextOverline(next)
                      if (canvas && t) {
                        (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('overline', next)
                        canvas.requestRenderAll()
                      }
                    }}
                  >
                    上划线
                  </Button>
                </Space>
              </div>
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel}>对齐</span>
                <Radio.Group
                  size="small"
                  value={textAlign}
                  options={[
                    { label: '左', value: 'left' },
                    { label: '中', value: 'center' },
                    { label: '右', value: 'right' },
                  ]}
                  onChange={(e) => {
                    const v = e.target.value as 'left' | 'center' | 'right'
                    setTextAlign(v)
                    if (canvas && t) {
                      (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('textAlign', v)
                      canvas.requestRenderAll()
                    }
                  }}
                />
              </div>
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel}>行高</span>
                <InputNumber
                  size="small"
                  min={0.6}
                  max={3}
                  step={0.1}
                  precision={1}
                  value={textLineHeight}
                  style={{ width: 90 }}
                  onChange={(v) => {
                    const val = typeof v === 'number' ? Math.max(0.6, Math.min(3, Number(v.toFixed(1)))) : 1.2
                    setTextLineHeight(val)
                    if (canvas && t) {
                      (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('lineHeight', val)
                      canvas.requestRenderAll()
                    }
                  }}
                />
              </div>
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel}>字间距</span>
                <InputNumber
                  size="small"
                  min={-200}
                  max={1000}
                  step={10}
                  precision={0}
                  value={textCharSpacing}
                  style={{ width: 90 }}
                  onChange={(v) => {
                    const val = typeof v === 'number' ? Math.max(-200, Math.min(1000, Math.round(v))) : 0
                    setTextCharSpacing(val)
                    if (canvas && t) {
                      (t as FabricType.Object & { set: (key: string, value: unknown) => void }).set('charSpacing', val)
                      canvas.requestRenderAll()
                    }
                  }}
                />
              </div>
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel}>批量字号</span>
                <Space size={6}>
                  <InputNumber
                    min={1}
                    max={50}
                    precision={0}
                    value={textBatchStep}
                    onChange={(v) => {
                      const n = typeof v === 'number' ? Math.max(1, Math.min(50, Math.round(v))) : 2
                      setTextBatchStep(n)
                    }}
                    size="small"
                    style={{ width: 64 }}
                  />
                  <Button size="small" onClick={() => adjustAllTextFontSize(-textBatchStep)}>全部 -</Button>
                  <Button size="small" onClick={() => adjustAllTextFontSize(textBatchStep)}>全部 +</Button>
                  <Button size="small" type="primary" onClick={() => setAllTextFontSize(textFontSize)}>设为当前</Button>
                </Space>
              </div>
              <div className={styles.recolorRow} style={{ alignItems: 'flex-start' }}>
                <span className={styles.recolorLabel}>应用项</span>
                <Checkbox.Group
                  value={textApplyFields}
                  options={[
                    { label: '字号', value: 'fontSize' },
                    { label: '颜色', value: 'fill' },
                    { label: '字体', value: 'fontFamily' },
                    { label: '粗体', value: 'fontWeight' },
                    { label: '斜体', value: 'fontStyle' },
                    { label: '对齐', value: 'textAlign' },
                    { label: '下划线', value: 'underline' },
                    { label: '中划线', value: 'linethrough' },
                    { label: '上划线', value: 'overline' },
                    { label: '行高', value: 'lineHeight' },
                    { label: '字间距', value: 'charSpacing' },
                  ]}
                  onChange={(vals) => setTextApplyFields(vals as Array<'fontSize' | 'fill' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'textAlign' | 'underline' | 'linethrough' | 'overline' | 'lineHeight' | 'charSpacing'>)}
                />
              </div>
              <div className={styles.recolorRow}>
                <span className={styles.recolorLabel} />
                <Button type="primary" size="small" onClick={applyCurrentTextStyleToAll} disabled={textApplyFields.length === 0}>
                  应用到全部文本
                </Button>
              </div>
            </div>
          )
        })()}
          </div>
        )}
        <Button
          type="text"
          icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          onClick={toggleFullscreen}
          className={styles.fullscreenButton}
          title={isFullscreen ? '退出全屏' : '全屏'}
        />
      </div>

      <SplitImageModal
        open={!!splitPayload}
        imageDataUrl={splitPayload?.dataUrl ?? ''}
        imageWidth={splitPayload?.imgWidth ?? 1}
        imageHeight={splitPayload?.imgHeight ?? 1}
        onConfirm={handleSplitConfirm}
        onCancel={() => setSplitPayload(null)}
      />
      <Modal
        title="快捷键帮助"
        open={shortcutHelpOpen}
        onCancel={() => setShortcutHelpOpen(false)}
        footer={null}
        width={420}
      >
        <div className={styles.shortcutHelpList}>
          <div><kbd>V</kbd><span>选择/移动</span></div>
          <div><kbd>R</kbd><span>框选填色（进入框选）</span></div>
          <div><kbd>T</kbd><span>文本工具（添加文本）</span></div>
          <div><kbd>S</kbd><span>拆分图层（需选中图片）</span></div>
          <div><kbd>D</kbd><span>重绘工具（需选中图片）</span></div>
          <div><kbd>Ctrl/Cmd + C</kbd><span>复制图层</span></div>
          <div><kbd>Ctrl/Cmd + V</kbd><span>粘贴图层</span></div>
          <div><kbd>Delete / Backspace</kbd><span>删除图层</span></div>
          <div><kbd>?</kbd><span>打开快捷键帮助</span></div>
        </div>
      </Modal>
      <Tour
        open={canvasTourOpen}
        current={canvasTourCurrent}
        onChange={(next) => setCanvasTourCurrent(next)}
        onClose={() => {
          setCanvasTourOpen(false)
          localStorage.setItem(CANVAS_TOUR_SEEN_KEY, '1')
        }}
        steps={canvasTourSteps}
      />
    </div>
  )
}

export default LayoutEditor

