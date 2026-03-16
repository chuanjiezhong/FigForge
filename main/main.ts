import { app, BrowserWindow, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

app.setName('FigForge')

// 在应用启动时设置 DOM polyfills（pdfjs-dist 需要）
async function setupDOMPolyfills() {
  if (typeof global !== 'undefined' && typeof window === 'undefined') {
    try {
      // 动态导入 canvas 包以获取 polyfill
      const canvasModule = await import('canvas')
      const canvas = canvasModule.default || canvasModule
      
      // 设置 DOMMatrix
      if (!global.DOMMatrix) {
        global.DOMMatrix = class DOMMatrix {
          a: number
          b: number
          c: number
          d: number
          e: number
          f: number
          
          constructor(init?: string | number[]) {
            if (typeof init === 'string') {
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
      
      // 设置 ImageData 和 Path2D
      if (!global.ImageData) {
        if (canvas.ImageData) {
          global.ImageData = canvas.ImageData
        } else {
          // 如果 canvas 包没有提供，创建一个简单的 polyfill
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
      
      if (!global.Path2D) {
        if (canvas.Path2D) {
          global.Path2D = canvas.Path2D
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
        }
      }
      
      console.log('Path2D 设置:', typeof global.Path2D)
      console.log('ImageData 设置:', typeof global.ImageData)
    } catch (error) {
      // 静默失败，不影响应用启动
      console.warn('设置 DOM polyfills 失败（可选）:', error)
    }
  }
}
import { setupRProcessorEvents } from './ipc-handlers'

// 修复 sharp 在打包后的路径问题
if (app.isPackaged) {
  try {
    // 设置 sharp 的原生库路径
    const sharpPath = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp')
    const libvipsPath = join(sharpPath, 'lib', 'libvips-cpp.42.dylib')
    
    // 设置环境变量
    process.env.SHARP_LIBVIPS_BINARY_PATH = libvipsPath
    
    // 对于 macOS，还需要设置 DYLD_LIBRARY_PATH
    if (process.platform === 'darwin') {
      const libPath = join(sharpPath, 'lib')
      if (!process.env.DYLD_LIBRARY_PATH) {
        process.env.DYLD_LIBRARY_PATH = libPath
      } else {
        process.env.DYLD_LIBRARY_PATH = `${libPath}:${process.env.DYLD_LIBRARY_PATH}`
      }
    }
  } catch (error) {
    console.error('Failed to set sharp library path:', error)
  }
}

let mainWindow: BrowserWindow | null = null

function resolveRuntimeIconPath(): string | undefined {
  const ext = process.platform === 'win32' ? 'ico' : 'png'
  const candidates = [
    join(process.cwd(), 'build', `icon.${ext}`),
    join(app.getAppPath(), 'build', `icon.${ext}`),
    join(__dirname, '..', '..', 'build', `icon.${ext}`),
    join(__dirname, '..', '..', '..', 'build', `icon.${ext}`),
  ]
  return candidates.find((p) => existsSync(p))
}

function resolveRuntimeIcon() {
  const iconPath = resolveRuntimeIconPath()
  if (!iconPath) return null
  const iconImage = nativeImage.createFromPath(iconPath)
  if (iconImage.isEmpty()) return null
  return { iconPath, iconImage }
}

function createWindow() {
  const runtimeIcon = resolveRuntimeIcon()
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    ...(runtimeIcon?.iconPath ? { icon: runtimeIcon.iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true, // 允许 DevTools
    },
  })

  // 开发环境加载 Vite 开发服务器，生产环境加载打包后的文件
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    
    // 打开 DevTools，并设置为分离模式（更像浏览器）
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    
    // 添加 F12 快捷键支持（像浏览器一样）
    mainWindow.webContents.on('before-input-event', (event, input) => {
      // F12 或 Cmd+Option+I (macOS) / Ctrl+Shift+I (Windows/Linux)
      if (input.key === 'F12' || 
          (input.key === 'I' && input.control && input.shift) ||
          (input.key === 'I' && input.meta && input.alt)) {
        if (mainWindow) {
          if (mainWindow.webContents.isDevToolsOpened()) {
            mainWindow.webContents.closeDevTools()
          } else {
            mainWindow.webContents.openDevTools({ mode: 'detach' })
          }
        }
        event.preventDefault()
      }
    })
  } else {
    // 打包后的路径处理
    // electron-vite 构建后，renderer 在 app.asar/out/renderer/index.html
    // 使用绝对路径确保正确加载
    const rendererPath = join(process.resourcesPath, 'app.asar', 'out', 'renderer', 'index.html')
    
    console.log('Loading renderer from:', rendererPath)
    
    // 使用 loadFile 加载，它会自动处理 asar 路径
    if (mainWindow) {
      mainWindow.loadFile(rendererPath).catch((error) => {
        console.error('Failed to load renderer:', error)
        // 如果绝对路径失败，尝试相对路径
        if (mainWindow) {
          const relativePath = join(__dirname, '../renderer/index.html')
          console.log('Trying relative path:', relativePath)
          mainWindow.loadFile(relativePath).catch((err) => {
            console.error('All load attempts failed:', err)
          })
        }
      })
    }
  }
  
  // 监听页面加载错误
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Page load failed:', {
      errorCode,
      errorDescription,
      validatedURL
    })
  })

  // 设置 R Processor 事件监听
  if (mainWindow) {
    setupRProcessorEvents(mainWindow)
  }

  // macOS 开发态默认是 Electron 图标，这里显式设置 Dock 图标
  if (process.platform === 'darwin' && runtimeIcon?.iconImage && app.dock) {
    app.dock.setIcon(runtimeIcon.iconImage)
  }
}

// 在应用启动时设置 DOM polyfills
setupDOMPolyfills().catch(err => {
  console.warn('设置 DOM polyfills 失败（可选）:', err)
})

app.whenReady().then(() => {
  const runtimeIcon = resolveRuntimeIcon()
  if (process.platform === 'darwin' && runtimeIcon?.iconImage && app.dock) {
    app.dock.setIcon(runtimeIcon.iconImage)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

