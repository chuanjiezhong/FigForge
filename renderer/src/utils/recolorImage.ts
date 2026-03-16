/**
 * 图片渐变重映射：根据原图渐变反推像素位置 t，再用新渐变取色替换。
 * 供画布填色面板等复用。
 */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '')
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  return [0, 0, 0]
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function gradientAt(
  rgbs: [number, number, number][],
  t: number
): [number, number, number] {
  if (rgbs.length === 1) return rgbs[0]
  if (rgbs.length === 2) return lerpRgb(rgbs[0], rgbs[1], t)
  if (t <= 0.5) return lerpRgb(rgbs[0], rgbs[1], t * 2)
  return lerpRgb(rgbs[1], rgbs[2], (t - 0.5) * 2)
}

function dist(
  a: [number, number, number],
  b: [number, number, number]
): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

/** 返回在原渐变上最近点的 t 以及该像素到渐变的距离（平方，用于和阈值比较） */
function findTAndDist(
  pixel: [number, number, number],
  oldRgbs: [number, number, number][]
): { t: number; distSq: number } {
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
  return { t: bestT, distSq: bestD }
}

export const DEFAULT_OLD_GRADIENT = ['#0000FF', '#FFFFFF', '#FF0000']

export type Rgb3 = [number, number, number]

/** 填色模式：渐变重映射（按 t 插值） / 纯色替换（原色→新色成对替换） */
export type RecolorMode = 'gradient' | 'solid'

/**
 * 在指定尺寸下渲染重配色图，返回 PNG data URL。
 * region 为 null 时重绘整图；否则仅重绘该区域（归一化 0~1）。
 * mode 'gradient'：按原渐变 t 用新渐变插值；onlyRecolorNearGradient 为 true 时只改靠近原渐变的像素。
 * mode 'solid'：每对 (oldRgbs[i], newRgbs[i]) 替换；只改与某原色距离 <= threshold 的像素，其它保留。
 */
export function renderRecoloredAtSize(
  imageDataUrl: string,
  width: number,
  height: number,
  oldRgbs: Rgb3[],
  newRgbs: Rgb3[],
  region: { x: number; y: number; w: number; h: number } | null = null,
  options?: {
    mode?: RecolorMode
    onlyRecolorNearGradient?: boolean
    thresholdSq?: number
  }
): Promise<string> {
  const mode = options?.mode ?? 'gradient'
  const onlyNear = options?.onlyRecolorNearGradient ?? false
  const thresholdSq = options?.thresholdSq ?? 2500
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
      const orig = new Uint8ClampedArray(data)
      // 纯色模式：先在选区内做一遍颜色统计，找出占比最高的非白色主色，后续只对“接近主色”的像素做替换
      let solidOld: Rgb3 | null = null
      let solidNew: Rgb3 | null = null
      if (mode === 'solid') {
        const buckets = new Map<string, { rgb: Rgb3; count: number }>()
        const step = 8 // 颜色量化步长，减小桶数量
        const collect = (r: number, g: number, b: number) => {
          const brightness = (r + g + b) / 3
          if (brightness > 245) return // 近似白色视为背景，不参与统计
          const qr = Math.max(0, Math.min(255, Math.round(r / step) * step))
          const qg = Math.max(0, Math.min(255, Math.round(g / step) * step))
          const qb = Math.max(0, Math.min(255, Math.round(b / step) * step))
          const key = `${qr},${qg},${qb}`
          const existed = buckets.get(key)
          if (existed) {
            existed.count += 1
          } else {
            buckets.set(key, { rgb: [qr, qg, qb], count: 1 })
          }
        }
        if (!region) {
          for (let i = 0; i < orig.length; i += 4) {
            collect(orig[i], orig[i + 1], orig[i + 2])
          }
        } else {
          const { x, y, w, h } = region
          for (let py = 0; py < height; py++) {
            const ny = py / height
            if (ny < y || ny > y + h) continue
            for (let px = 0; px < width; px++) {
              const nx = px / width
              if (nx < x || nx > x + w) continue
              const i = (py * width + px) * 4
              collect(orig[i], orig[i + 1], orig[i + 2])
            }
          }
        }
        let best: { rgb: Rgb3; count: number } | null = null
        for (const b of buckets.values()) {
          if (!best || b.count > best.count) best = b
        }
        if (best && newRgbs.length > 0) {
          solidOld = best.rgb
          solidNew = newRgbs[0]
        }
      }
      const applyRecolor = (
        i: number,
        r: number,
        g: number,
        b: number,
        a: number
      ) => {
        const pixel: Rgb3 = [r, g, b]
        if (mode === 'solid') {
          // 纯色：仅对“接近主色”的像素做替换；白底（接近纯白）保持不变
          if (!solidOld || !solidNew) return
          const brightness = (r + g + b) / 3
          if (brightness > 245) return
          const d = dist(pixel, solidOld)
          if (d > thresholdSq) return
          const [nr, ng, nb] = solidNew
          data[i] = nr
          data[i + 1] = ng
          data[i + 2] = nb
          data[i + 3] = a
          return
        }
        const { t, distSq } = findTAndDist(pixel, oldRgbs)
        if (onlyNear && distSq > thresholdSq) return
        const [nr, ng, nb] = gradientAt(newRgbs, t)
        data[i] = nr
        data[i + 1] = ng
        data[i + 2] = nb
        data[i + 3] = a
      }
      if (!region) {
        for (let i = 0; i < data.length; i += 4) {
          applyRecolor(i, orig[i], orig[i + 1], orig[i + 2], orig[i + 3])
        }
      } else {
        const { x, y, w, h } = region
        for (let py = 0; py < height; py++) {
          const ny = py / height
          if (ny < y || ny > y + h) continue
          for (let px = 0; px < width; px++) {
            const nx = px / width
            if (nx < x || nx > x + w) continue
            const i = (py * width + px) * 4
            applyRecolor(i, orig[i], orig[i + 1], orig[i + 2], orig[i + 3])
          }
        }
      }
      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = imageDataUrl
  })
}

/**
 * 对图片做填色，使用原图尺寸，返回新 data URL。
 * mode 'gradient'：渐变重映射；onlyRecolorNearGradient 为 true 时只改靠近原渐变的像素。
 * mode 'solid'：纯色替换，每对原色→新色替换，仅改与某原色距离在阈值内的像素。
 */
export async function recolorImage(
  imageDataUrl: string,
  oldGradientHexes: string[],
  newGradientHexes: string[],
  region: { x: number; y: number; w: number; h: number } | null = null,
  options?: {
    mode?: RecolorMode
    onlyRecolorNearGradient?: boolean
    thresholdSq?: number
  }
): Promise<string> {
  const oldRgbs = oldGradientHexes
    .slice(0, 3)
    .map(hexToRgb) as Rgb3[]
  let newRgbs = newGradientHexes
    .slice(0, 3)
    .map(hexToRgb) as Rgb3[]
  if (options?.mode === 'solid') {
    while (newRgbs.length < oldRgbs.length) newRgbs.push([255, 255, 255])
  } else if (newRgbs.length < 2) {
    newRgbs = [...newRgbs, [255, 255, 255], [255, 0, 0]]
  }
  const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('原图加载失败'))
    img.src = imageDataUrl
  })
  return renderRecoloredAtSize(
    imageDataUrl,
    size.w,
    size.h,
    oldRgbs,
    newRgbs,
    region,
    options
  )
}
