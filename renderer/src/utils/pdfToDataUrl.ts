/**
 * 在渲染进程用 PDF.js 将 PDF 第一页转为 PNG dataURL，供 Fabric 等直接使用。
 * 参考 react-test：不经过主进程转换，无 IPC/临时文件，响应更快。
 */

// PDF.js 内部可能调用 URL.parse，Electron 渲染进程部分版本无此静态方法，先做兼容
if (typeof globalThis.URL !== 'undefined' && typeof (globalThis.URL as URL & { parse?: unknown }).parse !== 'function') {
  ;(globalThis.URL as URL & { parse: (url: string, base?: string) => URL }).parse = function (url: string, base?: string) {
    return base !== undefined ? new URL(url, base) : new URL(url)
  }
}

import * as pdfjsLib from 'pdfjs-dist'

// Vite：用 ?url 解析 worker，打包后路径正确
// @ts-expect-error - pdfjs worker 路径
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'

if (typeof pdfjsWorker === 'string') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker
}

export interface PdfFirstPageResult {
  dataUrl: string
  width: number
  height: number
}

/**
 * 将 PDF（data URL 或 ArrayBuffer）的第一页渲染为 PNG dataURL
 * @param pdfDataUrlOrBuffer - 主进程 readFile 返回的 data:application/pdf;base64,... 或 ArrayBuffer
 * @param scale - 渲染缩放，默认 2，越大越清晰
 */
export async function pdfFirstPageToDataUrl(
  pdfDataUrlOrBuffer: string | ArrayBuffer,
  scale = 2
): Promise<PdfFirstPageResult> {
  const loadingTask =
    typeof pdfDataUrlOrBuffer === 'string'
      ? pdfjsLib.getDocument({ url: pdfDataUrlOrBuffer })
      : pdfjsLib.getDocument({ data: pdfDataUrlOrBuffer })
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d not available')
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
  }).promise
  const dataUrl = canvas.toDataURL('image/png')
  return {
    dataUrl,
    width: viewport.width,
    height: viewport.height,
  }
}
