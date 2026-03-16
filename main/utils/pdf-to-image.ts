import { BrowserWindow } from 'electron'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'

// 延迟加载 pdfjs-dist 和 canvas（如果可用）
let pdfjsLib: typeof import('pdfjs-dist') | null = null
let canvasLib: typeof import('canvas') | null = null

/**
 * 设置 DOM API polyfill（pdfjs-dist 在 Node.js 环境中需要）
 */
async function setupDOMPolyfills() {
  // 只在 Node.js 环境中设置（global 存在但 window 不存在）
  if (typeof global !== 'undefined' && typeof window === 'undefined') {
    try {
      // 动态导入 canvas 包以获取 polyfill
      const canvasModule = await import('canvas')
      const canvas = canvasModule.default || canvasModule
      
      // 设置 DOMMatrix - canvas 包可能不直接提供，需要手动实现
      if (!global.DOMMatrix) {
        // 简单的 DOMMatrix polyfill
        global.DOMMatrix = class DOMMatrix {
          a: number
          b: number
          c: number
          d: number
          e: number
          f: number
          
          constructor(init?: string | number[]) {
            if (typeof init === 'string') {
              // 解析 matrix() 字符串，例如 "matrix(1, 0, 0, 1, 0, 0)"
              const match = init.match(/matrix\(([^)]+)\)/)
              if (match) {
                const values = match[1].split(',').map(v => parseFloat(v.trim()))
                this.a = values[0] ?? 1
                this.b = values[1] ?? 0
                this.c = values[2] ?? 0
                this.d = values[3] ?? 1
                this.e = values[4] ?? 0
                this.f = values[5] ?? 0
              } else {
                this.a = 1
                this.b = 0
                this.c = 0
                this.d = 1
                this.e = 0
                this.f = 0
              }
            } else if (Array.isArray(init)) {
              this.a = init[0] ?? 1
              this.b = init[1] ?? 0
              this.c = init[2] ?? 0
              this.d = init[3] ?? 1
              this.e = init[4] ?? 0
              this.f = init[5] ?? 0
            } else {
              this.a = 1
              this.b = 0
              this.c = 0
              this.d = 1
              this.e = 0
              this.f = 0
            }
          }
        } as any
      }
      
      // 设置 ImageData
      if (!global.ImageData) {
        if (canvas.ImageData) {
          global.ImageData = canvas.ImageData
        } else {
          // 简单的 ImageData polyfill
          global.ImageData = class ImageData {
            data: Uint8ClampedArray
            width: number
            height: number
            constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight?: number) {
              if (typeof dataOrWidth === 'number') {
                this.width = dataOrWidth
                this.height = widthOrHeight || dataOrWidth
                this.data = new Uint8ClampedArray(this.width * this.height * 4)
              } else {
                this.data = dataOrWidth
                this.width = widthOrHeight || 0
                this.height = this.data.length / (this.width * 4)
              }
            }
          } as any
        }
      }
      
      // 设置 Path2D（关键！pdfjs-dist 需要这个）
      if (!global.Path2D) {
        if (canvas.Path2D) {
          global.Path2D = canvas.Path2D
          console.log('使用 canvas 包的 Path2D')
        } else {
          // 如果 canvas 包没有提供，创建一个简单的 polyfill
          global.Path2D = class Path2D {
            private commands: Array<{ type: string; args: number[] }> = []
            
            constructor(path?: string | Path2D) {
              if (path instanceof Path2D) {
                this.commands = [...path.commands]
              }
            }
            
            moveTo(x: number, y: number) {
              this.commands.push({ type: 'moveTo', args: [x, y] })
            }
            
            lineTo(x: number, y: number) {
              this.commands.push({ type: 'lineTo', args: [x, y] })
            }
            
            bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
              this.commands.push({ type: 'bezierCurveTo', args: [cp1x, cp1y, cp2x, cp2y, x, y] })
            }
            
            quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
              this.commands.push({ type: 'quadraticCurveTo', args: [cpx, cpy, x, y] })
            }
            
            arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean) {
              this.commands.push({ type: 'arc', args: [x, y, radius, startAngle, endAngle, anticlockwise ? 1 : 0] })
            }
            
            arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
              this.commands.push({ type: 'arcTo', args: [x1, y1, x2, y2, radius] })
            }
            
            ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number, anticlockwise?: boolean) {
              this.commands.push({ type: 'ellipse', args: [x, y, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise ? 1 : 0] })
            }
            
            rect(x: number, y: number, w: number, h: number) {
              this.commands.push({ type: 'rect', args: [x, y, w, h] })
            }
            
            closePath() {
              this.commands.push({ type: 'closePath', args: [] })
            }
          } as any
          console.log('使用自定义 Path2D polyfill')
        }
      }
      
      console.log('Path2D 类型:', typeof global.Path2D)
      
      console.log('DOM polyfills 设置完成')
    } catch (error) {
      console.warn('设置 DOM polyfills 失败:', error)
    }
  }
}

async function getPdfJs() {
  if (!pdfjsLib) {
    try {
      // 先设置 DOM polyfills
      await setupDOMPolyfills()
      
      // pdfjs-dist v5+ 在 Node.js 环境中使用 .mjs 文件
      // 优先尝试 legacy 构建（更适合 Node.js 环境）
      let imported: any = null
      
      // 方式1: 尝试使用 legacy 构建 (推荐用于 Node.js)
      try {
        imported = await import('pdfjs-dist/legacy/build/pdf.mjs')
        console.log('使用 pdfjs-dist/legacy/build/pdf.mjs 加载')
      } catch (e1) {
        // 方式2: 尝试使用主入口
        try {
          imported = await import('pdfjs-dist/build/pdf.mjs')
          console.log('使用 pdfjs-dist/build/pdf.mjs 加载')
        } catch (e2) {
          // 方式3: 尝试直接导入
          try {
            imported = await import('pdfjs-dist')
            console.log('使用 pdfjs-dist 直接导入')
          } catch (e3) {
            console.error('所有导入方式都失败:', { e1, e2, e3 })
            throw new Error('无法加载 pdfjs-dist')
          }
        }
      }
      
      pdfjsLib = imported
      
      // 在 Node.js 环境中，尝试设置 worker 路径
      if (pdfjsLib.GlobalWorkerOptions) {
        try {
          // 尝试使用绝对路径
          const { app } = await import('electron')
          let workerPath: string
          
          if (app.isPackaged) {
            // 打包后的路径
            workerPath = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
          } else {
            // 开发环境的路径
            workerPath = resolve(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
          }
          
          // 检查文件是否存在
          if (existsSync(workerPath)) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath
            console.log('设置 worker 路径（绝对路径）:', workerPath)
          } else {
            // 如果文件不存在，尝试使用相对路径
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs'
            console.log('设置 worker 路径（相对路径）:', pdfjsLib.GlobalWorkerOptions.workerSrc)
          }
        } catch (error) {
          console.warn('设置 worker 路径失败，尝试禁用 worker:', error)
          // 如果设置失败，尝试禁用（但这可能导致错误）
          pdfjsLib.GlobalWorkerOptions.workerSrc = ''
        }
      }
      
      console.log('pdfjs-dist 加载成功')
    } catch (error) {
      console.error('pdfjs-dist 加载失败:', error)
      return null
    }
  }
  return pdfjsLib
}

async function getCanvas() {
  if (!canvasLib) {
    try {
      canvasLib = await import('canvas')
      console.log('canvas 加载成功')
    } catch (error) {
      console.error('canvas 加载失败:', error)
      return null
    }
  }
  return canvasLib
}

/**
 * 使用 pdfjs-dist 和 canvas 快速将 PDF 的第一页转换为 PNG 图片
 * 这个方法比 BrowserWindow 方法快 5-10 倍
 */
async function convertPdfToImageWithPdfJs(
  pdfPath: string
): Promise<{ success: boolean; imagePath?: string; error?: string }> {
  try {
    const pdfjs = await getPdfJs()
    const canvas = await getCanvas()
    
    if (!pdfjs) {
      return { success: false, error: 'pdfjs-dist 未安装或加载失败' }
    }
    
    if (!canvas) {
      return { success: false, error: 'canvas 未安装或加载失败' }
    }

    // 读取 PDF 文件
    const fs = await import('fs/promises')
    const pdfBuffer = await fs.readFile(pdfPath)
    
    // pdfjs-dist 需要 Uint8Array 而不是 Buffer
    const pdfData = new Uint8Array(pdfBuffer)
    
    console.log('开始加载 PDF 文档，数据大小:', pdfData.length)

    // 加载 PDF 文档
    const loadingTask = pdfjs.getDocument({ 
      data: pdfData,
      // 禁用 worker（在 Node.js 环境中）
      useWorkerFetch: false,
      isEvalSupported: false,
      // 启用字体渲染
      standardFontDataUrl: undefined, // 使用默认字体
      // 启用所有渲染选项
      disableFontFace: false,
      disableAutoFetch: false,
    })
    const pdf = await loadingTask.promise
    
    console.log('PDF 文档加载成功，总页数:', pdf.numPages)

    // 获取第一页
    const page = await pdf.getPage(1)
    console.log('获取第一页成功')

    // 增加缩放比例以提高渲染质量（3.0 = 300% DPI，相当于 216 DPI）
    const scale = 3.0
    const viewport = page.getViewport({ scale })
    console.log('Viewport 尺寸:', viewport.width, 'x', viewport.height)

    // 创建 canvas
    const canvasInstance = canvas.createCanvas(viewport.width, viewport.height)
    const context = canvasInstance.getContext('2d')
    console.log('Canvas 创建成功')

    // 设置白色背景
    context.fillStyle = 'white'
    context.fillRect(0, 0, viewport.width, viewport.height)

    // 渲染 PDF 页面到 canvas
    const renderContext = {
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport: viewport,
      // 启用所有渲染选项
      enableWebGL: false, // Node.js 环境不支持 WebGL
      renderInteractiveForms: false, // 不渲染交互式表单
    }

    await page.render(renderContext).promise
    console.log('PDF 页面渲染完成')

    // 将 canvas 转换为 PNG buffer
    const imageBuffer = canvasInstance.toBuffer('image/png')
    console.log('Canvas 转换为 PNG，大小:', imageBuffer.length)

    // 保存到临时文件
    const { basename } = await import('path')
    const pdfName = basename(pdfPath, '.pdf')
    const tempImagePath = join(tmpdir(), `pdf_${Date.now()}_${pdfName}.png`)
    await writeFile(tempImagePath, imageBuffer)
    console.log('临时图片保存成功:', tempImagePath)

    return { success: true, imagePath: tempImagePath }
  } catch (error) {
    console.error('pdfjs-dist 转换失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

/**
 * 使用 BrowserWindow 将 PDF 的第一页转换为 PNG 图片（降级方案）
 */
async function convertPdfToImageWithBrowserWindow(
  pdfPath: string
): Promise<{ success: boolean; imagePath?: string; error?: string }> {
  let tempWindow: BrowserWindow | null = null

  // 性能分析：记录各个步骤的耗时
  const perfStart = Date.now()
  const perfLog: Record<string, number> = {}

  try {
    // 检查 PDF 文件是否存在
    if (!existsSync(pdfPath)) {
      return { success: false, error: 'PDF 文件不存在' }
    }

    // 创建临时图片路径
    const { basename } = await import('path')
    const pdfName = basename(pdfPath, '.pdf')
    const tempImagePath = join(tmpdir(), `pdf_${Date.now()}_${pdfName}.png`)

    // 创建隐藏窗口来加载 PDF
    // 使用适中的窗口大小以平衡质量和速度
    const createWindowStart = Date.now()
    tempWindow = new BrowserWindow({
      show: false,
      width: 1600, // 适中的宽度，平衡质量和速度
      height: 2000, // 适中的高度，平衡质量和速度
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true, // 启用插件支持（PDF 查看器）
        webSecurity: false, // 允许加载本地文件
        // 启用硬件加速以提高渲染速度
        enableBlinkFeatures: 'CSSColorSchemeUARendering',
        // 禁用一些不必要的功能以提高速度
        backgroundThrottling: false,
      },
    })
    perfLog['创建窗口'] = Date.now() - createWindowStart
    console.log(`[性能] 创建窗口耗时: ${perfLog['创建窗口']}ms`)

    // 加载 PDF 文件 - 使用 encodeURI 处理路径中的特殊字符
    const pdfUrl = `file://${encodeURI(pdfPath.replace(/\\/g, '/'))}`
    console.log('Loading PDF URL:', pdfUrl)

    // 先注册事件监听器，再加载 URL（避免错过事件）
    const loadPromise = new Promise<void>((resolve, reject) => {
      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          reject(new Error('PDF 加载超时'))
        }
      }, 10000) // 减少到 10 秒超时

      const cleanup = () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
        }
      }

      // 使用更智能的检测方式：通过执行 JavaScript 检测 PDF 是否加载完成
      const checkPdfReady = async () => {
        if (!tempWindow || tempWindow.isDestroyed() || resolved) return false

        try {
          const jsStart = Date.now()
          // 尝试执行 JavaScript 检测 PDF 是否已加载
          const result = await tempWindow.webContents.executeJavaScript(`
            (function() {
              // 检查是否有 PDF 查看器元素
              const embed = document.querySelector('embed[type="application/pdf"]');
              const object = document.querySelector('object[type="application/pdf"]');
              if (embed || object) {
                return true;
              }
              // 检查 body 是否有内容（PDF 查看器通常会在 body 中渲染）
              return document.body && document.body.children.length > 0;
            })()
          `).catch(() => false)
          const jsTime = Date.now() - jsStart
          if (jsTime > 50) {
            console.log(`[性能] executeJavaScript耗时: ${jsTime}ms`)
          }

          return result === true
        } catch {
          return false
        }
      }

      const handleFinishLoad = async () => {
        if (resolved) return

        // 快速检查：先等待 50ms，然后检测 PDF 是否就绪
        await new Promise((resolve) => setTimeout(resolve, 50))

        // 尝试检测 PDF 是否真的准备好了（最多等待 0.6 秒）
        let attempts = 0
        const maxAttempts = 3 // 最多尝试 3 次，每次 200ms = 最多 0.6 秒

        while (attempts < maxAttempts && !resolved) {
          const isReady = await checkPdfReady()
          if (isReady) {
            cleanup()
            if (tempWindow && !tempWindow.isDestroyed() && !resolved) {
              resolve()
            }
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 200))
          attempts++
        }

        // 如果检测失败，再等待 150ms 后继续（给 PDF 更多时间渲染）
        await new Promise((resolve) => setTimeout(resolve, 150))
        cleanup()
        if (tempWindow && !tempWindow.isDestroyed() && !resolved) {
          resolve()
        }
      }

      const handleFailLoad = (
        _: unknown,
        errorCode: number,
        errorDescription: string
      ) => {
        cleanup()
        reject(new Error(`PDF 加载失败: ${errorDescription} (${errorCode})`))
      }

      // 优先使用 dom-ready（通常更快）
      tempWindow!.webContents.once('dom-ready', () => {
        if (!resolved) {
          handleFinishLoad()
        }
      })

      // 监听其他事件作为后备
      tempWindow!.webContents.once('did-finish-load', handleFinishLoad)
      tempWindow!.webContents.once('did-fail-load', handleFailLoad)
    })

    const loadStart = Date.now()
    await tempWindow.loadURL(pdfUrl)
    perfLog['loadURL调用'] = Date.now() - loadStart
    console.log(`[性能] loadURL调用耗时: ${perfLog['loadURL调用']}ms`)

    const loadPromiseStart = Date.now()
    await loadPromise
    perfLog['等待PDF加载'] = Date.now() - loadPromiseStart
    console.log(`[性能] 等待PDF加载耗时: ${perfLog['等待PDF加载']}ms`)

    // 使用更智能的方式检测 PDF 是否完全渲染（包括图形元素）
    console.log('检测 PDF 渲染状态...')
    const renderCheckStart = Date.now()
    
    // 方法1：等待 PDF 查看器加载完成（减少初始等待时间）
    await new Promise(resolve => setTimeout(resolve, 300)) // 初始等待 300ms（减少 200ms）
    
    // 方法2：使用 JavaScript 检测 PDF 内容是否已渲染
    let renderComplete = false
    let attempts = 0
    const maxAttempts = 4 // 最多尝试 4 次，每次 200ms = 最多 0.8 秒（减少 2 次）
    
    while (!renderComplete && attempts < maxAttempts) {
      try {
        const jsStart = Date.now()
        // 执行 JavaScript 检测 PDF 是否完全渲染
        const result = await tempWindow!.webContents.executeJavaScript(`
          (function() {
            // 检查 PDF 查看器是否已加载
            const embed = document.querySelector('embed[type="application/pdf"]');
            const object = document.querySelector('object[type="application/pdf"]');
            if (!embed && !object) return false;
            
            // 检查是否有内容渲染
            const hasContent = document.body && document.body.children.length > 0;
            
            // 尝试检测 PDF 是否真的渲染了内容
            const bodyHasSize = document.body && (
              document.body.scrollWidth > 0 || 
              document.body.scrollHeight > 0
            );
            
            return hasContent && bodyHasSize;
          })()
        `)
        const jsTime = Date.now() - jsStart
        if (jsTime > 50) {
          console.log(`[性能] 渲染检测executeJavaScript耗时: ${jsTime}ms`)
        }
        
        if (result) {
          // 再等待 300ms 确保所有图形元素（如数据点、线条）都渲染完成（减少 100ms）
          await new Promise(resolve => setTimeout(resolve, 300))
          renderComplete = true
          console.log('PDF 渲染完成')
          break
        }
      } catch (error) {
        console.warn('检测渲染状态时出错:', error)
      }
      
      await new Promise(resolve => setTimeout(resolve, 200))
      attempts++
    }
    
    if (!renderComplete) {
      // 即使检测失败，也等待一段时间确保渲染（减少等待时间）
      console.warn('PDF 渲染检测未完成，额外等待 300ms 确保渲染...')
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    perfLog['检测渲染状态'] = Date.now() - renderCheckStart
    console.log(`[性能] 检测渲染状态耗时: ${perfLog['检测渲染状态']}ms`)

    // 截图第一页
    console.log('开始截图...')
    const captureStart = Date.now()
    const image = await tempWindow.webContents.capturePage()
    perfLog['capturePage'] = Date.now() - captureStart
    console.log(`[性能] capturePage耗时: ${perfLog['capturePage']}ms`)

    const convertStart = Date.now()
    const imageBuffer = image.toPNG()
    perfLog['toPNG转换'] = Date.now() - convertStart
    console.log(`[性能] toPNG转换耗时: ${perfLog['toPNG转换']}ms`)

    const writeStart = Date.now()
    await writeFile(tempImagePath, imageBuffer)
    perfLog['写入文件'] = Date.now() - writeStart
    console.log(`[性能] 写入文件耗时: ${perfLog['写入文件']}ms`)

    const totalTime = Date.now() - perfStart
    console.log(`[性能] ========== PDF转换总耗时: ${totalTime}ms ==========`)
    console.log(`[性能] 各步骤耗时详情:`, perfLog)
    console.log(`[性能] 各步骤占比:`, Object.entries(perfLog).map(([key, time]) => 
      `${key}: ${((time / totalTime) * 100).toFixed(1)}%`
    ).join(', '))
    console.log('截图保存成功:', tempImagePath)

    // 关闭临时窗口
    tempWindow.close()
    tempWindow = null

    return { success: true, imagePath: tempImagePath }
  } catch (error) {
    if (tempWindow) {
      tempWindow.close()
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

/**
 * 使用 pdf-poppler 快速转换 PDF（需要系统安装 Poppler）
 * 这个方法比 BrowserWindow 快 5-10 倍（约 0.3-0.5 秒）
 */
async function convertPdfToImageWithPoppler(
  pdfPath: string
): Promise<{ success: boolean; imagePath?: string; error?: string }> {
  try {
    // 动态导入 pdf-poppler（如果可用）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfPoppler: any = await import('pdf-poppler').catch(() => null)
    if (!pdfPoppler) {
      return { success: false, error: 'pdf-poppler 未安装，需要运行: brew install poppler (macOS) 或 apt-get install poppler-utils (Linux)' }
    }

    const { basename } = await import('path')
    const pdfName = basename(pdfPath, '.pdf')
    const tempImagePath = join(tmpdir(), `pdf_${Date.now()}_${pdfName}.png`)

    // 使用 pdf-poppler 转换第一页
    const options = {
      format: 'png',
      out_dir: tmpdir(),
      out_prefix: `pdf_${Date.now()}_${pdfName}`,
      page: 1, // 只转换第一页
      scale: 2.0, // 2x 缩放以提高质量
    }

    await pdfPoppler.convert(pdfPath, options)
    
    // pdf-poppler 生成的文件名格式：{out_prefix}-{page}.png
    const generatedPath = join(tmpdir(), `${options.out_prefix}-1.png`)
    
    // 如果文件存在，重命名到目标路径
    if (existsSync(generatedPath)) {
      const fs = await import('fs/promises')
      await fs.rename(generatedPath, tempImagePath)
      return { success: true, imagePath: tempImagePath }
    } else {
      return { success: false, error: 'pdf-poppler 转换失败：未生成输出文件' }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

/**
 * 使用 pdfjs-dist 将 PDF 的第一页转换为 SVG 格式（不需要 Poppler）
 * 
 * 这个方法使用 pdfjs-dist 解析 PDF，然后渲染到 canvas，最后将 canvas 转换为 SVG
 * 注意：由于是通过 canvas 渲染，复杂图形可能会被栅格化，但对于大多数情况已经足够
 */
async function convertPdfToSvgWithPdfJs(
  pdfPath: string
): Promise<{ success: boolean; svgPath?: string; error?: string }> {
  try {
    const pdfjs = await getPdfJs()
    const canvas = await getCanvas()
    
    if (!pdfjs) {
      return { success: false, error: 'pdfjs-dist 未安装或加载失败' }
    }
    
    if (!canvas) {
      return { success: false, error: 'canvas 未安装或加载失败' }
    }

    // 读取 PDF 文件
    const fs = await import('fs/promises')
    const pdfBuffer = await fs.readFile(pdfPath)
    const pdfData = new Uint8Array(pdfBuffer)

    // 加载 PDF 文档
    const loadingTask = pdfjs.getDocument({ 
      data: pdfData,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: false,
      disableAutoFetch: false,
    })
    const pdf = await loadingTask.promise

    // 获取第一页
    const page = await pdf.getPage(1)
    const scale = 2.0 // 适中的缩放比例
    const viewport = page.getViewport({ scale })

    // 创建 canvas
    const canvasInstance = canvas.createCanvas(viewport.width, viewport.height)
    const context = canvasInstance.getContext('2d')

    // 设置白色背景
    context.fillStyle = 'white'
    context.fillRect(0, 0, viewport.width, viewport.height)

    // 渲染 PDF 页面到 canvas
    const renderContext = {
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport: viewport,
      enableWebGL: false,
      renderInteractiveForms: false,
    }

    await page.render(renderContext).promise

    // 将 canvas 转换为 SVG
    // 使用 canvas 的 toDataURL 获取 base64，然后嵌入到 SVG 中
    const imageDataUrl = canvasInstance.toDataURL('image/png')
    const base64Data = imageDataUrl.split(',')[1] // 移除 data:image/png;base64, 前缀

    // 创建 SVG，将 PNG 图片嵌入其中
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
     width="${viewport.width}" height="${viewport.height}" viewBox="0 0 ${viewport.width} ${viewport.height}">
  <image x="0" y="0" width="${viewport.width}" height="${viewport.height}" 
         xlink:href="data:image/png;base64,${base64Data}"/>
</svg>`

    // 保存 SVG 文件
    const { basename } = await import('path')
    const pdfName = basename(pdfPath, '.pdf')
    const tempSvgPath = join(tmpdir(), `pdf_${Date.now()}_${pdfName}.svg`)
    await writeFile(tempSvgPath, svgContent, 'utf-8')

    console.log('✅ PDF 转 SVG 成功（使用 pdfjs-dist）:', tempSvgPath)
    return { success: true, svgPath: tempSvgPath }
  } catch (error) {
    console.error('pdfjs-dist 转 SVG 失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

/**
 * 使用 Puppeteer 将 PDF 转换为 SVG（基于 Chromium，可能比 BrowserWindow 更快）
 */
async function convertPdfToSvgWithPuppeteer(
  pdfPath: string
): Promise<{ success: boolean; svgPath?: string; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null
  try {
    // 动态导入 Puppeteer
    const puppeteer = await import('puppeteer').catch(() => null)
    if (!puppeteer) {
      return { success: false, error: 'puppeteer 未安装' }
    }

    // 启动浏览器（使用无头模式）
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const page = await browser.newPage()

    // 加载 PDF 文件
    const pdfUrl = `file://${pdfPath.replace(/\\/g, '/')}`
    await page.goto(pdfUrl, { waitUntil: 'networkidle0', timeout: 30000 })

    // 等待 PDF 渲染完成
    await page.waitForTimeout(1000)

    // 截图并转换为 base64
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
    })

    // 获取页面尺寸
    const dimensions = await page.evaluate(() => {
      return {
        width: document.body.scrollWidth || window.innerWidth,
        height: document.body.scrollHeight || window.innerHeight,
      }
    })

    await browser.close()
    browser = null

    // 将截图转换为 base64
    const base64Data = (screenshot as Buffer).toString('base64')

    // 创建 SVG，将 PNG 图片嵌入其中
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
     width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">
  <image x="0" y="0" width="${dimensions.width}" height="${dimensions.height}" 
         xlink:href="data:image/png;base64,${base64Data}"/>
</svg>`

    // 保存 SVG 文件
    const { basename } = await import('path')
    const pdfName = basename(pdfPath, '.pdf')
    const tempSvgPath = join(tmpdir(), `pdf_${Date.now()}_${pdfName}.svg`)
    await writeFile(tempSvgPath, svgContent, 'utf-8')

    console.log('✅ PDF 转 SVG 成功（使用 Puppeteer/Chromium）:', tempSvgPath)
    return { success: true, svgPath: tempSvgPath }
  } catch (error) {
    if (browser) {
      try {
        await browser.close()
      } catch {
        // 忽略关闭错误
      }
    }
    console.error('Puppeteer 转 SVG 失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

/**
 * 将 PDF 的第一页转换为 SVG 格式（不需要 Poppler）
 * 
 * 优先使用 Puppeteer（基于 Chromium，可能更快），如果失败则使用 BrowserWindow 方法
 * 确保完整渲染所有图形元素（包括数据点、线条等）
 * 虽然生成的 SVG 是包含 PNG 图片的 SVG（不是纯矢量），但可以完整保留所有图形内容
 */
export async function convertPdfToSvg(
  pdfPath: string
): Promise<{ success: boolean; svgPath?: string; error?: string }> {
  try {
    // 检查 PDF 文件是否存在
    if (!existsSync(pdfPath)) {
      return { success: false, error: 'PDF 文件不存在' }
    }

    // 优先尝试使用 Puppeteer（基于 Chromium，可能比 BrowserWindow 更快）
    console.log('尝试使用 Puppeteer/Chromium 转换 PDF 为 SVG...')
    const puppeteerResult = await convertPdfToSvgWithPuppeteer(pdfPath)
    if (puppeteerResult.success) {
      return puppeteerResult
    }

    // 如果 Puppeteer 失败，使用 BrowserWindow 方法（也是基于 Chromium）
    console.log('⚠️ Puppeteer 转换失败，使用 BrowserWindow 方法（也是基于 Chromium）...')
    console.log('提示:', puppeteerResult.error)
    return convertPdfToSvgWithBrowserWindow(pdfPath)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

/**
 * 使用 BrowserWindow 将 PDF 转换为 SVG（后备方案）
 */
async function convertPdfToSvgWithBrowserWindow(
  pdfPath: string
): Promise<{ success: boolean; svgPath?: string; error?: string }> {
  try {
    // 先转换为 PNG，然后嵌入到 SVG 中
    const imageResult = await convertPdfToImageWithBrowserWindow(pdfPath)
    if (!imageResult.success || !imageResult.imagePath) {
      return { success: false, error: imageResult.error || 'PDF 转图片失败' }
    }

    // 读取 PNG 图片并转换为 base64
    const { readFile } = await import('fs/promises')
    const imageBuffer = await readFile(imageResult.imagePath)
    const base64Data = imageBuffer.toString('base64')

    // 获取图片尺寸（使用 canvas 的 loadImage）
    const canvasLib = await getCanvas()
    let imgWidth = 1600
    let imgHeight = 2000
    
    if (canvasLib) {
      try {
        // 使用 canvas 的 loadImage 获取图片尺寸
        const { loadImage } = canvasLib
        const img = await loadImage(imageBuffer)
        imgWidth = img.width
        imgHeight = img.height
      } catch (error) {
        console.warn('无法获取图片尺寸，使用默认尺寸:', error)
      }
    }
    
    // 创建 SVG，将 PNG 图片嵌入其中
    // 虽然这不是纯矢量图，但可以完整保留所有图形内容（包括数据点、线条等）
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
     width="${imgWidth}" height="${imgHeight}" viewBox="0 0 ${imgWidth} ${imgHeight}">
  <image x="0" y="0" width="${imgWidth}" height="${imgHeight}" 
         xlink:href="data:image/png;base64,${base64Data}"/>
</svg>`

    // 保存 SVG 文件
    const { basename } = await import('path')
    const pdfName = basename(pdfPath, '.pdf')
    const tempSvgPath = join(tmpdir(), `pdf_${Date.now()}_${pdfName}.svg`)
    await writeFile(tempSvgPath, svgContent, 'utf-8')

    // 清理临时 PNG 文件
    try {
      await import('fs/promises').then(fs => fs.unlink(imageResult.imagePath!))
    } catch {
      // 忽略删除错误
    }

    console.log('✅ PDF 转 SVG 成功（使用 BrowserWindow，完整渲染所有图形）:', tempSvgPath)
    return { success: true, svgPath: tempSvgPath }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}


/**
 * 将 PDF 的第一页转换为 PNG 图片
 * 
 * 优先尝试使用 pdf-poppler（最快，约 0.3-0.5 秒），如果不可用则使用 BrowserWindow 方法（约 1-2 秒）
 * 
 * 注意：pdf-poppler 需要系统安装 Poppler：
 * - macOS: brew install poppler
 * - Linux: apt-get install poppler-utils 或 yum install poppler-utils
 * - Windows: 下载 Poppler 并添加到 PATH
 */
export async function convertPdfToImage(
  pdfPath: string
): Promise<{ success: boolean; imagePath?: string; error?: string }> {
  // 优先尝试使用 pdf-poppler（最快）
  console.log('尝试使用 pdf-poppler 转换 PDF（最快方法）...')
  const popplerResult = await convertPdfToImageWithPoppler(pdfPath)
  if (popplerResult.success) {
    console.log('✅ 使用 pdf-poppler 成功转换 PDF（快速方法，约 0.3-0.5 秒）')
    return popplerResult
  }

  // 如果 pdf-poppler 不可用，使用 BrowserWindow 方法
  console.log('⚠️ pdf-poppler 不可用，使用 BrowserWindow 方法（较慢但可靠）')
  console.log('提示:', popplerResult.error)
  console.log('使用 BrowserWindow 方法转换 PDF（预计 1-2 秒）...')
  return convertPdfToImageWithBrowserWindow(pdfPath)
}
