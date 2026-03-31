import { contextBridge, ipcRenderer } from 'electron'

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // R 引擎相关
  runRPipeline: (pipelineId: string, params: Record<string, unknown>) =>
    ipcRenderer.invoke('run-r-pipeline', pipelineId, params),
  
  getPipelineProgress: (jobId: string) =>
    ipcRenderer.invoke('get-pipeline-progress', jobId),
  
  cancelPipeline: (jobId: string) =>
    ipcRenderer.invoke('cancel-pipeline', jobId),

  // 导出引擎相关
  exportToPDF: (layoutData: unknown, options: Record<string, unknown>) =>
    ipcRenderer.invoke('export-to-pdf', layoutData, options),
  
  onExportProgress: (callback: (progress: number, message: string) => void) => {
    const handler = (_: unknown, data: { progress: number; message: string }) => {
      callback(data.progress, data.message)
    }
    ipcRenderer.on('export-progress', handler)
    return () => {
      ipcRenderer.removeListener('export-progress', handler)
    }
  },
  
  exportToImage: (layoutData: unknown, options: Record<string, unknown>) =>
    ipcRenderer.invoke('export-to-image', layoutData, options),
  
  exportToSVG: (svgString: string, outputPath: string) =>
    ipcRenderer.invoke('export-to-svg', svgString, outputPath),

  // 文件系统相关
  readFile: (path: string) =>
    ipcRenderer.invoke('read-file', path),

  /** 在系统文件管理器中显示文件（选中该文件） */
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke('show-item-in-folder', filePath) as Promise<{ success: boolean; error?: string }>,
  
  writeFile: (path: string, data: string) =>
    ipcRenderer.invoke('write-file', path, data),

  /** HTML → .docx（主进程 html-to-docx） */
  exportHtmlToDocx: (html: string, filePath: string) =>
    ipcRenderer.invoke('export-html-to-docx', html, filePath) as Promise<{ success: boolean; error?: string }>,

  /** 清空 out_dir/_pipeline/status 下 *.json，重新跑 Pipeline 前避免旧节点状态 */
  clearPipelineStatusDir: (statusDir: string) =>
    ipcRenderer.invoke('clear-pipeline-status-dir', statusDir) as Promise<{ success: boolean; error?: string }>,
  
  selectDirectory: () =>
    ipcRenderer.invoke('select-directory'),
  
  selectSavePath: (options?: { defaultPath?: string; filters?: Electron.FileFilter[] }) =>
    ipcRenderer.invoke('select-save-path', options),
  
  selectFiles: (options?: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('select-files', options),

  // R 函数相关
  getRFunctions: (packageName?: string, scriptPath?: string) =>
    ipcRenderer.invoke('get-r-functions', packageName, scriptPath),
  
  callRFunction: (
    functionName: string,
    packageName: string | undefined,
    params: Record<string, unknown>,
    inputFiles: string[]
  ) => ipcRenderer.invoke('call-r-function', functionName, packageName, params, inputFiles),

  // 生成/执行 R 脚本（用于可视化调试）
  generateRFunctionScript: (
    functionName: string,
    packageName: string | undefined,
    params: Record<string, unknown>,
    inputFiles: string[]
  ) => ipcRenderer.invoke('generate-r-function-script', functionName, packageName, params, inputFiles),

  runRScript: (outputDir: string, scriptContent: string) =>
    ipcRenderer.invoke('run-r-script', outputDir, scriptContent),

  onRunRScriptResult: (callback: (result: { success: boolean; outputDir?: string; error?: string }) => void) => {
    const handler = (_: unknown, result: { success: boolean; outputDir?: string; error?: string }) => callback(result)
    ipcRenderer.on('run-r-script-result', handler)
    return () => ipcRenderer.removeListener('run-r-script-result', handler)
  },

  cancelCurrentRScript: () => ipcRenderer.invoke('cancel-current-r-script'),

  // 运行函数并记录历史
  runRFunctionRecorded: (
    functionName: string,
    packageName: string | undefined,
    params: Record<string, unknown>,
    inputFiles: string[]
  ) => ipcRenderer.invoke('run-r-function-recorded', functionName, packageName, params, inputFiles),

  getRFunctionDoc: (functionName: string, packageName?: string) =>
    ipcRenderer.invoke('get-r-function-doc', functionName, packageName),

  // Pipeline defs（用于流程图渲染）
  getPipelineDefs: (packageName?: string) =>
    ipcRenderer.invoke('get-pipeline-defs', packageName),

  // 函数文档管理相关
  getFunctionDocConfig: () =>
    ipcRenderer.invoke('get-function-doc-config'),
  
  saveFunctionDoc: (functionDoc: unknown) =>
    ipcRenderer.invoke('save-function-doc', functionDoc),
  
  deleteFunctionDoc: (functionName: string, packageName?: string) =>
    ipcRenderer.invoke('delete-function-doc', functionName, packageName),
  
  getAllFunctionDocs: () =>
    ipcRenderer.invoke('get-all-function-docs'),

  // R 包更新（从 GitHub 安装/更新）
  getRPackageUpdateList: () =>
    ipcRenderer.invoke('get-r-package-update-list'),
  installRPackageFromGitHub: (repo: string) =>
    ipcRenderer.invoke('install-r-package-from-github', repo),
  getGitHubToken: () =>
    ipcRenderer.invoke('get-github-token'),
  setGitHubToken: (token: string) =>
    ipcRenderer.invoke('set-github-token', token),

  // 运行记录
  getRunHistory: (limit?: number) =>
    ipcRenderer.invoke('get-run-history', limit),
  getRunRecord: (id: string) =>
    ipcRenderer.invoke('get-run-record', id),
  deleteRunRecord: (id: string) =>
    ipcRenderer.invoke('delete-run-record', id),
  clearRunHistory: () =>
    ipcRenderer.invoke('clear-run-history'),

  // 文件系统相关（用于结果查看）
  listFiles: (dir: string, options?: { extensions?: string[]; recursive?: boolean }) =>
    ipcRenderer.invoke('list-files', dir, options),
  
  copyFiles: (files: string[], targetDir: string) =>
    ipcRenderer.invoke('copy-files', files, targetDir),
  
  convertPdfToImage: (pdfPath: string) =>
    ipcRenderer.invoke('convert-pdf-to-image', pdfPath),
  
  convertPdfToSvg: (pdfPath: string) =>
    ipcRenderer.invoke('convert-pdf-to-svg', pdfPath),
  
  readImageAsDataUrl: (imagePath: string) =>
    ipcRenderer.invoke('read-image-as-data-url', imagePath),

  /** 从 RDS 重绘（指明重绘函数名与包名，由 function-docs 的 redrawFunction 决定） */
  redrawFromRds: (options: {
    outputDir: string
    redrawFunctionName: string
    packageName?: string
    rdsFile?: string
    palette?: string[]
    annotation_colors_list?: string
    fontsize?: number
    width?: number
    height?: number
    scale_rows?: string
    cluster_cols?: boolean
    show_gene_names?: boolean
    image_format?: string
    dpi?: number
  }) => ipcRenderer.invoke('redraw-from-rds', options) as Promise<{
    success: boolean
    imagePath?: string
    error?: string
    assembledCall?: string
  }>,

  // Pipeline 配置相关
  getPipelineConfig: () =>
    ipcRenderer.invoke('get-pipeline-config'),
  
  savePipelineConfig: (config: unknown) =>
    ipcRenderer.invoke('save-pipeline-config', config),

  // Git 仓库管理
  checkGitAvailable: () =>
    ipcRenderer.invoke('check-git-available'),
  
  cloneGitRepository: (repoUrl: string, targetPath?: string, branch?: string, authOptions?: { sshKeyPath?: string; token?: string }) =>
    ipcRenderer.invoke('clone-git-repository', repoUrl, targetPath, branch, authOptions),
  
  updateGitRepository: (repoPath: string, branch?: string, authOptions?: { sshKeyPath?: string; token?: string }) =>
    ipcRenderer.invoke('update-git-repository', repoPath, branch, authOptions),
  
  addExternalPipelineDir: (dirPath: string) =>
    ipcRenderer.invoke('add-external-pipeline-dir', dirPath),
  
  removeExternalPipelineDir: (dirPath: string) =>
    ipcRenderer.invoke('remove-external-pipeline-dir', dirPath),
})

// TypeScript 类型定义
export type ElectronAPI = {
  runRPipeline: (pipelineId: string, params: Record<string, unknown>) => Promise<unknown>
  getPipelineProgress: (jobId: string) => Promise<unknown>
  cancelPipeline: (jobId: string) => Promise<unknown>
  exportToPDF: (layoutData: unknown, options: Record<string, unknown>) => Promise<unknown>
  onExportProgress: (callback: (progress: number, message: string) => void) => (() => void)
  exportToImage: (layoutData: unknown, options: Record<string, unknown>) => Promise<unknown>
  exportToSVG: (svgString: string, outputPath: string) => Promise<{ success: boolean; error?: string }>
  readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>
  showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
  writeFile: (path: string, data: string) => Promise<{ success: boolean; error?: string }>
  exportHtmlToDocx: (html: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  clearPipelineStatusDir: (statusDir: string) => Promise<{ success: boolean; error?: string }>
  selectDirectory: () => Promise<string | null>
  selectSavePath: (options?: { defaultPath?: string; filters?: Electron.FileFilter[] }) => Promise<string | null>
  selectFiles: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string[]>
  // R 函数相关
  getRFunctions: (packageName?: string, scriptPath?: string) => Promise<{ success: boolean; functions?: unknown[]; error?: string }>
  callRFunction: (functionName: string, packageName: string | undefined, params: Record<string, unknown>, inputFiles: string[]) => Promise<{ success: boolean; outputDir?: string; error?: string }>
  generateRFunctionScript: (functionName: string, packageName: string | undefined, params: Record<string, unknown>, inputFiles: string[]) => Promise<{ success: boolean; outputDir?: string; script?: string; error?: string }>
  runRScript: (outputDir: string, scriptContent: string) => Promise<{ started?: boolean; success?: boolean; outputDir?: string; error?: string }>
  onRunRScriptResult: (callback: (result: { success: boolean; outputDir?: string; error?: string }) => void) => () => void
  cancelCurrentRScript: () => Promise<{ success: boolean }>
  runRFunctionRecorded: (functionName: string, packageName: string | undefined, params: Record<string, unknown>, inputFiles: string[]) => Promise<{ success: boolean; outputDir?: string; recordId?: string; error?: string }>
  getRFunctionDoc: (functionName: string, packageName?: string) => Promise<{ success: boolean; documentation?: string; detailedParameters?: unknown[]; description?: string; examples?: string; error?: string }>
  getPipelineDefs: (packageName?: string) => Promise<{ success: boolean; defs?: unknown; error?: string }>
  // 函数文档管理相关
  getFunctionDocConfig: () => Promise<{ success: boolean; config?: unknown; error?: string }>
  saveFunctionDoc: (functionDoc: unknown) => Promise<{ success: boolean; error?: string }>
  deleteFunctionDoc: (functionName: string, packageName?: string) => Promise<{ success: boolean; error?: string }>
  getAllFunctionDocs: () => Promise<{ success: boolean; docs?: unknown[]; error?: string }>
  // 运行记录
  getRunHistory: (limit?: number) => Promise<{ success: boolean; records?: unknown[]; error?: string }>
  getRunRecord: (id: string) => Promise<{ success: boolean; record?: unknown; error?: string }>
  deleteRunRecord: (id: string) => Promise<{ success: boolean; error?: string }>
  clearRunHistory: () => Promise<{ success: boolean; error?: string }>
  // 文件系统相关（用于结果查看）
  listFiles: (dir: string, options?: { extensions?: string[]; recursive?: boolean }) => Promise<{ success: boolean; files?: string[]; error?: string }>
  copyFiles: (files: string[], targetDir: string) => Promise<{ success: boolean; files?: string[]; error?: string }>
  convertPdfToImage: (pdfPath: string) => Promise<{ success: boolean; imagePath?: string; error?: string }>
  convertPdfToSvg: (pdfPath: string) => Promise<{ success: boolean; svgPath?: string; error?: string }>
  readImageAsDataUrl: (imagePath: string) => Promise<{ success: boolean; dataUrl?: string; error?: string }>
  // Pipeline 配置相关
  getPipelineConfig: () => Promise<{ success: boolean; config?: unknown; error?: string }>
  savePipelineConfig: (config: unknown) => Promise<{ success: boolean; error?: string }>
  // Git 仓库管理
  checkGitAvailable: () => Promise<{ available: boolean }>
  cloneGitRepository: (repoUrl: string, targetPath?: string, branch?: string) => Promise<{ success: boolean; path?: string; updated?: boolean; error?: string }>
  updateGitRepository: (repoPath: string, branch?: string) => Promise<{ success: boolean; error?: string }>
  addExternalPipelineDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>
  removeExternalPipelineDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

