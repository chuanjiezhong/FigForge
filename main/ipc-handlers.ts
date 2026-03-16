import { ipcMain, dialog, app } from 'electron'
import { spawn } from 'child_process'
// NOTE: Main-process code changes require a full main bundle rebuild (electron-vite will do this in dev).
import { RProcessor } from './r-engine/r-processor'
import { PipelineManager } from './r-engine/pipeline-manager'
import { RFunctionManager } from './r-engine/r-function-manager'
import { PDFExporter } from './export-engine/pdf-exporter'
import { ImageExporter } from './export-engine/image-exporter'
import { GitManager } from './r-engine/git-manager'
import { FunctionDocsManager } from './r-engine/function-docs-manager'
import { RunHistoryManager } from './r-engine/run-history-manager'
import { getRscriptPath } from './r-engine/rscript-path'
import { 
  loadPipelineConfig, 
  savePipelineConfig, 
  addExternalPipelineDir,
  removeExternalPipelineDir 
} from './r-engine/pipeline-config'
import { readFile, writeFile, copyFile } from 'fs/promises'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { homedir } from 'os'
import { convertPdfToImage } from './utils/pdf-to-image'

const rProcessor = new RProcessor()
const pipelineManager = new PipelineManager()
const rFunctionManager = new RFunctionManager()
const pdfExporter = new PDFExporter()
const imageExporter = new ImageExporter()
const gitManager = new GitManager()
const functionDocsManager = new FunctionDocsManager()
const runHistoryManager = new RunHistoryManager()

/**
 * 可写的输出根目录。打包后从 Finder 启动时 process.cwd() 可能为 /，故改用 userData/output。
 *
 * 图片存储规则：
 * - 每次运行 R 函数/脚本时，主进程在此目录下创建子目录 job_<timestamp>（绝对路径）。
 * - R 脚本以该目录为 cwd 执行，生成的图片、RDS 等均写在此目录。
 * - 该绝对路径会返回给渲染进程并写入运行记录；运行记录中的 outputDir 必须为此路径，
 *   以便「运行记录 → 查看图片」能正确 listFiles/readImageAsDataUrl。
 */
function getOutputBaseDir(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return join(app.getPath('userData'), 'output')
    }
  } catch {
    // 非 Electron 或未就绪
  }
  return join(process.cwd(), 'output')
}

// R Pipeline 相关 IPC
ipcMain.handle('run-r-pipeline', async (_, pipelineId: string, params: Record<string, unknown>, pipelinePath?: string) => {
  try {
    // 创建输出目录（使用 userData/output，避免打包后 cwd 为 / 导致 mkdir /output 报错）
    const outputDir = join(getOutputBaseDir(), `job_${Date.now()}`)
    await mkdir(outputDir, { recursive: true })

    // 如果没有提供路径，尝试从 PipelineManager 获取
    let actualPath = pipelinePath
    if (!actualPath) {
      const pipelineInfo = await pipelineManager.getPipelineInfo(pipelineId)
      if (pipelineInfo) {
        actualPath = pipelineInfo.path
      }
    }

    const jobId = await rProcessor.runPipeline(pipelineId, params, outputDir, actualPath)
    return { success: true, jobId, outputDir }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('get-pipeline-progress', async (_, jobId: string) => {
  const status = rProcessor.getPipelineStatus(jobId)
  return { status }
})

ipcMain.handle('cancel-pipeline', async (_, jobId: string) => {
  const success = rProcessor.cancelPipeline(jobId)
  return { success }
})

// 导出相关 IPC
ipcMain.handle('export-to-pdf', async (event, layoutData: unknown, options: Record<string, unknown>) => {
  try {
    const { outputPath, ...exportOptions } = options as { outputPath: string; [key: string]: unknown }
    console.log('Exporting PDF with options:', { outputPath, exportOptions })
    console.log('Layout data type:', typeof layoutData, layoutData ? 'exists' : 'null/undefined')
    
    // 发送进度更新到渲染进程
    const progressCallback = (progress: number, message: string) => {
      event.sender.send('export-progress', { progress, message })
    }
    
    await pdfExporter.exportToPDF(layoutData, outputPath, exportOptions as any, progressCallback)
    return { success: true, path: outputPath }
  } catch (error) {
    console.error('PDF export error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error) || 'Unknown error'
    return { success: false, error: errorMessage }
  }
})

ipcMain.handle('export-to-image', async (_, layoutData: unknown, options: Record<string, unknown>) => {
  try {
    const { outputPath, ...exportOptions } = options as { outputPath: string; [key: string]: unknown }
    await imageExporter.exportToImage(layoutData, outputPath, exportOptions as any)
    return { success: true, path: outputPath }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// SVG 导出
ipcMain.handle('export-to-svg', async (_, svgString: string, outputPath: string) => {
  try {
    await writeFile(outputPath, svgString, 'utf-8')
    return { success: true, path: outputPath }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 文件系统相关 IPC
ipcMain.handle('read-file', async (_, filePath: string) => {
  try {
    // 对于 PDF 文件，返回 base64 编码的二进制数据
    const { extname } = await import('path')
    const ext = extname(filePath).toLowerCase()
    
    if (ext === '.pdf') {
      // PDF 文件需要以二进制方式读取
      const buffer = await readFile(filePath)
      // 返回 base64 编码的 data URL（作为 content 返回）
      const base64Data = `data:application/pdf;base64,${buffer.toString('base64')}`
      return { success: true, content: base64Data }
    } else {
      // 文本文件按 UTF-8 读取
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('write-file', async (_, filePath: string, data: string) => {
  try {
    await writeFile(filePath, data, 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  
  if (result.canceled) {
    return null
  }
  
  return result.filePaths[0]
})

// 选择保存文件路径
ipcMain.handle('select-save-path', async (_, options?: { defaultPath?: string; filters?: Electron.FileFilter[] }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: options?.defaultPath || 'export',
    filters: options?.filters || [
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  
  if (result.canceled) {
    return null
  }
  
  return result.filePath || null
})

ipcMain.handle('select-files', async (_, options?: Electron.OpenDialogOptions) => {
  const defaultFilters = [
    { name: 'All Files', extensions: ['*'] },
    { name: 'Text Files', extensions: ['txt', 'csv', 'tsv'] },
    { name: 'R Data Files', extensions: ['rds', 'RData'] },
  ]
  
  // 合并 options，确保 filters 和 properties 正确设置
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: options?.properties || ['openFile', 'multiSelections'],
    filters: options?.filters || defaultFilters,
    ...options,
  }
  
  const result = await dialog.showOpenDialog(dialogOptions)
  
  if (result.canceled) {
    return []
  }
  
  return result.filePaths
})

// 列出目录中的文件
ipcMain.handle('list-files', async (_, dir: string, options?: { extensions?: string[]; recursive?: boolean }) => {
  try {
    const { readdir, stat } = await import('fs/promises')
    const { join, extname } = await import('path')

    const filePaths: string[] = []
    const exts = options?.extensions?.map((e) => e.toLowerCase())

    const walk = async (currentDir: string) => {
      const entries = await readdir(currentDir)
      for (const entry of entries) {
        const entryPath = join(currentDir, entry)
        const entryStat = await stat(entryPath)
        if (entryStat.isDirectory()) {
          if (options?.recursive) {
            await walk(entryPath)
          }
          continue
        }
        if (exts && exts.length > 0) {
          const ext = extname(entry).slice(1).toLowerCase()
          if (exts.includes(ext)) filePaths.push(entryPath)
        } else {
          filePaths.push(entryPath)
        }
      }
    }

    await walk(dir)
    return { success: true, files: filePaths }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 批量复制文件
ipcMain.handle('copy-files', async (_, files: string[], targetDir: string) => {
  try {
    const { basename } = await import('path')
    const copiedFiles: string[] = []
    
    for (const filePath of files) {
      const fileName = basename(filePath)
      const destPath = join(targetDir, fileName)
      await copyFile(filePath, destPath)
      copiedFiles.push(destPath)
    }
    
    return { success: true, files: copiedFiles }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// PDF 转图片
ipcMain.handle('convert-pdf-to-image', async (_, pdfPath: string) => {
  try {
    const result = await convertPdfToImage(pdfPath)
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// PDF 转 SVG（矢量图，缩放不失真）
ipcMain.handle('convert-pdf-to-svg', async (_, pdfPath: string) => {
  try {
    const { convertPdfToSvg } = await import('./utils/pdf-to-image')
    const result = await convertPdfToSvg(pdfPath)
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 读取图片文件并转换为 base64 data URL
ipcMain.handle('read-image-as-data-url', async (_, imagePath: string) => {
  try {
    const { readFile } = await import('fs/promises')
    const { extname } = await import('path')
    
    // 读取图片文件
    const imageBuffer = await readFile(imagePath)
    
    // 根据文件扩展名确定 MIME 类型
    const ext = extname(imagePath).toLowerCase()
    let mimeType = 'image/png'
    
    if (ext === '.jpg' || ext === '.jpeg') {
      mimeType = 'image/jpeg'
    } else if (ext === '.gif') {
      mimeType = 'image/gif'
    } else if (ext === '.webp') {
      mimeType = 'image/webp'
    } else if (ext === '.svg') {
      mimeType = 'image/svg+xml'
    } else if (ext === '.bmp') {
      mimeType = 'image/bmp'
    } else if (ext === '.png') {
      mimeType = 'image/png'
    }
    
    // 转换为 base64
    const base64 = imageBuffer.toString('base64')
    const dataUrl = `data:${mimeType};base64,${base64}`
    
    return { success: true, dataUrl }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// R 函数相关 IPC
ipcMain.handle('get-r-functions', async (_, packageName?: string, scriptPath?: string) => {
  try {
    console.log('Getting R functions:', { packageName, scriptPath })
    let functions
    if (packageName) {
      functions = await rFunctionManager.getFunctionsFromPackage(packageName)
    } else if (scriptPath) {
      functions = await rFunctionManager.getFunctionsFromScript(scriptPath)
    } else {
      return { success: false, error: 'Either packageName or scriptPath must be provided' }
    }
    console.log('Found functions:', functions.length)
    return { success: true, functions }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error getting R functions:', errorMessage)
    return { success: false, error: errorMessage }
  }
})

ipcMain.handle('call-r-function', async (
  _,
  functionName: string,
  packageName: string | undefined,
  params: Record<string, unknown>,
  inputFiles: string[]
) => {
  try {
    const outputDir = join(getOutputBaseDir(), `job_${Date.now()}`)
    await mkdir(outputDir, { recursive: true })

    // 复制输入文件到输出目录
    const copiedFiles: string[] = []
    for (const file of inputFiles) {
      const fileName = file.split(/[/\\]/).pop() || 'file'
      const destPath = join(outputDir, fileName)
      await copyFile(file, destPath)
      copiedFiles.push(destPath)
    }

    // 调用 R 函数
    await rFunctionManager.callFunction(functionName, packageName, params, copiedFiles, outputDir)
    
    return { success: true, outputDir }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 运行 R 函数（生成脚本并记录运行历史）
ipcMain.handle('run-r-function-recorded', async (
  _,
  functionName: string,
  packageName: string | undefined,
  params: Record<string, unknown>,
  inputFiles: string[]
) => {
  const startedAt = Date.now()
  const outputDir = join(getOutputBaseDir(), `job_${startedAt}`)
  await mkdir(outputDir, { recursive: true })

  const id = `run_${startedAt}_${Math.random().toString(36).slice(2, 10)}`

  try {
    // 复制输入文件到输出目录
    const copiedFiles: string[] = []
    for (const file of inputFiles || []) {
      const fileName = file.split(/[/\\]/).pop() || 'file'
      const destPath = join(outputDir, fileName)
      await copyFile(file, destPath)
      copiedFiles.push(destPath)
    }

    const script = rFunctionManager.buildFunctionCallScript(functionName, packageName, params, copiedFiles, outputDir)

    runHistoryManager.create({
      id,
      functionName,
      packageName,
      startedAt,
      status: 'running',
      outputDir,
      script,
    })

    await rFunctionManager.runScriptFromContent(script, outputDir, 'call_function.R')

    runHistoryManager.update(id, { status: 'success', finishedAt: Date.now() })
    return { success: true, outputDir, recordId: id }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    runHistoryManager.update(id, { status: 'error', finishedAt: Date.now(), error: msg })
    return { success: false, outputDir, recordId: id, error: msg }
  }
})

// 生成 R 函数调用脚本（不执行）
ipcMain.handle('generate-r-function-script', async (
  _,
  functionName: string,
  packageName: string | undefined,
  params: Record<string, unknown>,
  inputFiles: string[]
) => {
  try {
    const outputDir = join(getOutputBaseDir(), `job_${Date.now()}`)
    await mkdir(outputDir, { recursive: true })

    // 复制输入文件到输出目录（如果传了 inputFiles）
    const copiedFiles: string[] = []
    for (const file of inputFiles || []) {
      const fileName = file.split(/[/\\]/).pop() || 'file'
      const destPath = join(outputDir, fileName)
      await copyFile(file, destPath)
      copiedFiles.push(destPath)
    }

    const script = rFunctionManager.buildFunctionCallScript(functionName, packageName, params, copiedFiles, outputDir)
    return { success: true, outputDir, script }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 执行用户编辑后的 R 脚本（不阻塞，便于取消按钮能及时被处理；结果通过 run-r-script-result 事件回传）
ipcMain.handle('run-r-script', (
  event: Electron.IpcMainInvokeEvent,
  outputDir: string,
  scriptContent: string
) => {
  console.log('[FigForge:main] run-r-script 收到请求, outputDir=', outputDir)
  event.sender.once('destroyed', () => {
    console.log('[FigForge:main] webContents destroyed，调用 killCurrentRun')
    rFunctionManager.killCurrentRun()
  })
  rFunctionManager
    .runScriptFromContent(scriptContent, outputDir, 'call_function.R')
    .then(() => {
      console.log('[FigForge:main] run-r-script 完成 success, outputDir=', outputDir)
      if (!event.sender.isDestroyed()) {
        event.sender.send('run-r-script-result', { success: true, outputDir })
      }
    })
    .catch((error: Error) => {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log('[FigForge:main] run-r-script 结束(失败/取消) error=', errMsg)
      if (!event.sender.isDestroyed()) {
        event.sender.send('run-r-script-result', {
          success: false,
          error: errMsg,
        })
      }
    })
  console.log('[FigForge:main] run-r-script 已启动，立即返回 started: true')
  return { started: true }
})

// 主动取消当前正在运行的 R 分析（如用户点击刷新前可先调用）
ipcMain.handle('cancel-current-r-script', async () => {
  console.log('[FigForge:main] cancel-current-r-script 收到请求')
  rFunctionManager.killCurrentRun()
  console.log('[FigForge:main] cancel-current-r-script 已调用 killCurrentRun，返回')
  return { success: true }
})

/** 从 RDS 重绘：参数严格按 transcriptome_redraw_heatmap_rds 文档，仅 rds_file, out_file, palette, annotation_colors_list, show_gene_names, fontsize, width, height, image_format, dpi（勿传 scale_rows/cluster_cols） */
const REDRAW_PREVIEW_FILENAME = 'heatmap_redraw_preview.png'

function escapeRPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/"/g, '\\"')
}

ipcMain.handle('redraw-from-rds', async (
  _,
  options: {
    outputDir: string
    /** 重绘函数名（由前端根据 function-docs 的 redrawFunction 传入，指明做的是哪个函数的重绘） */
    redrawFunctionName: string
    /** 重绘函数所在 R 包，默认 OmicsFlowCoreFullVersion */
    packageName?: string
    rdsFile?: string
    palette?: string[]
    /** R 表达式，如 list(Group=c(...), DataSet=c(...))，与 transcriptome_redraw_heatmap_rds 参数一致 */
    annotation_colors_list?: string
    fontsize?: number
    /** 图片宽度（英寸），可选 */
    width?: number
    /** 图片高度（英寸），可选 */
    height?: number
    show_gene_names?: boolean
    image_format?: string
    dpi?: number
  }
) => {
  const {
    outputDir,
    redrawFunctionName,
    packageName = 'OmicsFlowCoreFullVersion',
    rdsFile = 'heatmap.rds',
    palette = ['#0000FF', '#FFFFFF', '#FF0000'],
    annotation_colors_list,
    fontsize = 12,
    width,
    height,
    show_gene_names = false,
    image_format = 'png',
    dpi = 150,
  } = options
  const rdsPath = join(outputDir, rdsFile)
  const outPath = join(outputDir, REDRAW_PREVIEW_FILENAME)
  const debugPath = join(outputDir, 'redraw_preview_call.txt')
  const paletteR = palette.map((h) => `"${h.replace(/"/g, '\\"')}"`).join(', ')
  const pkg = packageName.replace(/"/g, '\\"')
  const widthArg = width != null && Number.isFinite(width) ? `, width = ${width}` : ''
  const heightArg = height != null && Number.isFinite(height) ? `, height = ${height}` : ''
  const annotationExpr =
    annotation_colors_list && typeof annotation_colors_list === 'string' && annotation_colors_list.trim().startsWith('list(')
      ? annotation_colors_list.trim()
      : null
  const assembledFallback = [
    `target function: ${redrawFunctionName}`,
    `rds_file = ${rdsPath}`,
    `out_file = ${outPath}`,
    `palette = c(${palette.join(', ')})`,
    `fontsize = ${Number(fontsize) || 12}`,
    `show_gene_names = ${show_gene_names ? 'TRUE' : 'FALSE'}`,
    `image_format = ${image_format}`,
    `dpi = ${Number(dpi) || 150}`,
    width != null && Number.isFinite(width) ? `width = ${width}` : '',
    height != null && Number.isFinite(height) ? `height = ${height}` : '',
    annotationExpr ? `annotation_colors_list = ${annotationExpr}` : '',
  ].filter(Boolean).join('\n')
  const script = `
library("${pkg}", character.only = TRUE)
rds_file <- "${escapeRPath(rdsPath)}"
out_file <- "${escapeRPath(outPath)}"
debug_file <- "${escapeRPath(debugPath)}"
palette_vec <- c(${paletteR})
fn <- get("${redrawFunctionName.replace(/"/g, '\\"')}", mode = "function")
fn_name <- "${redrawFunctionName.replace(/"/g, '\\"')}"
arg_names <- names(formals(fn))

# 若误传了“绘图函数”（通常要求 expr_file），自动切到通用重绘函数
if ("expr_file" %in% arg_names && !("rds_file" %in% arg_names)) {
  if (exists("transcriptome_redraw_heatmap_rds", mode = "function")) {
    fn <- get("transcriptome_redraw_heatmap_rds", mode = "function")
    fn_name <- "transcriptome_redraw_heatmap_rds"
    arg_names <- names(formals(fn))
    message("[FigForge:redraw] auto-switch redraw function: ", fn_name)
  }
}
args <- list()

# 必需/常用参数按函数签名自适应
if ("rds_file" %in% arg_names) args$rds_file <- rds_file
if ("out_file" %in% arg_names) args$out_file <- out_file
if ("palette" %in% arg_names) args$palette <- palette_vec
if ("fontsize" %in% arg_names) args$fontsize <- ${Number(fontsize) || 12}
if ("show_gene_names" %in% arg_names) args$show_gene_names <- ${show_gene_names ? 'TRUE' : 'FALSE'}
if ("image_format" %in% arg_names) args$image_format <- "${image_format}"
if ("dpi" %in% arg_names) args$dpi <- ${Number(dpi) || 150}
${widthArg ? 'if ("width" %in% arg_names) args$width <- ' + width : ''}
${heightArg ? 'if ("height" %in% arg_names) args$height <- ' + height : ''}
${annotationExpr ? 'if ("annotation_colors_list" %in% arg_names) args$annotation_colors_list <- ' + annotationExpr : ''}

arg_dump <- paste(
  vapply(names(args), function(k) {
    paste0(k, " = ", paste(deparse(args[[k]]), collapse = ""))
  }, character(1)),
  collapse = ", "
)
message("[FigForge:redraw] assembled args: ", arg_dump)
message("[FigForge:redraw] assembled call: ", fn_name, "(", arg_dump, ")")
try(writeLines(c(
  paste0("assembled args: ", arg_dump),
  paste0("assembled call: ", fn_name, "(", arg_dump, ")")
), con = debug_file), silent = TRUE)

invisible(do.call(fn, args))
`
  try {
    console.log('[FigForge:redraw] preview options:', {
      redrawFunctionName,
      packageName,
      rdsPath,
      outPath,
      palette,
      fontsize,
      width,
      height,
      show_gene_names,
      image_format,
      dpi,
      hasAnnotationColorsList: Boolean(annotationExpr),
    })
    console.log('[FigForge:redraw] generated script:\\n' + script)
    await rFunctionManager.runScriptFromContent(script, outputDir, 'redraw_from_rds.R')
    const { existsSync, readFileSync } = await import('fs')
    const assembledCall = existsSync(debugPath) ? readFileSync(debugPath, 'utf-8') : assembledFallback
    if (existsSync(outPath)) {
      return { success: true, imagePath: outPath, assembledCall }
    }
    return { success: false, error: '重绘完成但未找到输出文件', assembledCall }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const { existsSync, readFileSync } = await import('fs')
    const assembledCall = existsSync(debugPath) ? readFileSync(debugPath, 'utf-8') : assembledFallback
    return { success: false, error: msg, assembledCall }
  }
})

// 运行记录相关 IPC
ipcMain.handle('get-run-history', async (_, limit?: number) => {
  try {
    const records = runHistoryManager.list(typeof limit === 'number' ? limit : 200)
    return { success: true, records }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('get-run-record', async (_, id: string) => {
  try {
    const record = runHistoryManager.get(id)
    if (!record) return { success: false, error: 'Not found' }
    return { success: true, record }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('delete-run-record', async (_, id: string) => {
  try {
    runHistoryManager.delete(id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('clear-run-history', async () => {
  try {
    runHistoryManager.clear()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 获取 R 函数文档（优先使用内置文档，如果没有则从R包获取）
ipcMain.handle('get-r-function-doc', async (_, functionName: string, packageName?: string) => {
  try {
    console.log(`[IPC] Getting documentation for function: ${functionName}, package: ${packageName || 'none'}`)
    
    // 首先尝试从内置文档获取
    const builtInDoc = functionDocsManager.getFunctionDoc(functionName, packageName)
    if (builtInDoc && builtInDoc.documentation) {
      console.log(`[IPC] Using built-in documentation`)
      return { 
        success: true, 
        documentation: builtInDoc.documentation,
        detailedParameters: builtInDoc.detailedParameters,
        description: builtInDoc.description,
        examples: builtInDoc.examples
      }
    }
    
    // 如果没有内置文档，尝试从R包获取
    const documentation = await rFunctionManager.getFunctionDocumentation(functionName, packageName)
    console.log(`[IPC] Documentation retrieved from R, length: ${documentation?.length || 0}`)
    return { success: true, documentation }
  } catch (error) {
    console.error(`[IPC] Failed to get documentation:`, error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 函数文档管理相关 IPC
ipcMain.handle('get-function-doc-config', async () => {
  try {
    const config = functionDocsManager.loadConfig()
    return { success: true, config }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('save-function-doc', async (_, functionDoc) => {
  try {
    functionDocsManager.upsertFunctionDoc(functionDoc)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('delete-function-doc', async (_, functionName: string, packageName?: string) => {
  try {
    functionDocsManager.deleteFunctionDoc(functionName, packageName)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('get-all-function-docs', async () => {
  try {
    const docs = functionDocsManager.getAllFunctionDocs()
    return { success: true, docs }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// R 包更新（从 GitHub 安装/更新）
ipcMain.handle('get-r-package-update-list', async () => {
  try {
    const packages = functionDocsManager.getGithubPackages()
    return { success: true, packages }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error', packages: [] }
  }
})

ipcMain.handle('install-r-package-from-github', async (_, repo: string) => {
  if (!repo || typeof repo !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo.trim())) {
    return { success: false, error: '无效的 GitHub 仓库格式，应为 owner/repo' }
  }
  const repoEscaped = repo.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const rCode = [
    'if (!requireNamespace("remotes", quietly = TRUE)) {',
    '  install.packages("remotes", repos = "https://cloud.r-project.org", quiet = TRUE)',
    '}',
    `remotes::install_github("${repoEscaped}", upgrade = "always")`,
  ].join('\n')
  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    const rscriptPath = getRscriptPath()
    const child = spawn(rscriptPath, ['-e', rCode], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    child.stdout?.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('close', (code: number) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr || `R 进程退出码 ${code}` })
      }
    })
    child.on('error', (err: Error) => {
      resolve({ success: false, error: err.message })
    })
  })
})

// Pipeline 配置相关 IPC
ipcMain.handle('get-pipeline-config', async () => {
  try {
    const config = await loadPipelineConfig()
    return { success: true, config }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('save-pipeline-config', async (_, config) => {
  try {
    await savePipelineConfig(config)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Git 仓库管理 IPC
ipcMain.handle('check-git-available', async () => {
  const available = await gitManager.checkGitAvailable()
  return { available }
})

ipcMain.handle('clone-git-repository', async (_, repoUrl: string, targetPath?: string, branch?: string, authOptions?: { sshKeyPath?: string; token?: string }) => {
  try {
    // 如果没有指定路径，使用默认的外部 pipelines 目录
    if (!targetPath) {
      const repoInfo = gitManager.parseGitHubUrl(repoUrl)
      if (!repoInfo) {
        return { success: false, error: 'Invalid GitHub URL' }
      }
      targetPath = join(homedir(), '.figforge', 'external-pipelines', repoInfo.repo)
    }

    // 检查是否已存在
    const exists = await gitManager.repositoryExists(targetPath)
    if (exists) {
      // 如果存在，尝试更新
      const updateResult = await gitManager.updateRepository(targetPath, branch, authOptions)
      if (updateResult.success) {
        // 添加到配置
        await addExternalPipelineDir(targetPath)
        return { success: true, path: targetPath, updated: true }
      } else {
        return { success: false, error: updateResult.error }
      }
    }

    // 克隆仓库
    const result = await gitManager.cloneRepository(repoUrl, targetPath, branch, authOptions)
    if (result.success) {
      // 添加到配置
      await addExternalPipelineDir(targetPath)
      return { success: true, path: targetPath }
    } else {
      return { success: false, error: result.error }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('update-git-repository', async (_, repoPath: string, branch?: string, authOptions?: { sshKeyPath?: string; token?: string }) => {
  try {
    const result = await gitManager.updateRepository(repoPath, branch, authOptions)
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('add-external-pipeline-dir', async (_, dirPath: string) => {
  try {
    await addExternalPipelineDir(dirPath)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('remove-external-pipeline-dir', async (_, dirPath: string) => {
  try {
    await removeExternalPipelineDir(dirPath)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 监听 R Processor 事件并转发到渲染进程
// 注意：这需要在主窗口创建后设置
export function setupRProcessorEvents(mainWindow: Electron.BrowserWindow) {
  rProcessor.on('log', ({ jobId, log }) => {
    mainWindow.webContents.send('pipeline-log', { jobId, log })
  })

  rProcessor.on('complete', ({ jobId, outputDir }) => {
    mainWindow.webContents.send('pipeline-complete', { jobId, outputDir })
  })

  rProcessor.on('error', ({ jobId, error }) => {
    mainWindow.webContents.send('pipeline-error', { jobId, error })
  })

  rProcessor.on('cancelled', ({ jobId }) => {
    mainWindow.webContents.send('pipeline-cancelled', { jobId })
  })
}

