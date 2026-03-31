/**
 * Electron API 类型定义
 */
declare global {
  interface Window {
    electronAPI: {
      // R 引擎相关
      runRPipeline: (
        pipelineId: string,
        params: Record<string, unknown>
      ) => Promise<{ success: boolean; jobId?: string; outputDir?: string; error?: string }>
      getPipelineProgress: (jobId: string) => Promise<{ status: string }>
      cancelPipeline: (jobId: string) => Promise<{ success: boolean }>

      // 导出引擎相关
      exportToPDF: (
        layoutData: unknown,
        options: Record<string, unknown>
      ) => Promise<{ success: boolean; path?: string; error?: string }>
      onExportProgress: (
        callback: (progress: number, message: string) => void
      ) => () => void
      exportToImage: (
        layoutData: unknown,
        options: Record<string, unknown>
      ) => Promise<{ success: boolean; path?: string; error?: string }>
      exportToSVG: (
        svgString: string,
        outputPath: string
      ) => Promise<{ success: boolean; path?: string; error?: string }>

      // 文件系统相关
      readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>
      writeFile: (path: string, data: string) => Promise<{ success: boolean; error?: string }>
      /** 将 HTML 导出为 .docx（主进程） */
      exportHtmlToDocx: (html: string, filePath: string) => Promise<{ success: boolean; error?: string }>
      /** 清空 Pipeline 步骤状态目录，重新分析前避免读到旧 JSON */
      clearPipelineStatusDir: (statusDir: string) => Promise<{ success: boolean; error?: string }>
      selectDirectory: () => Promise<string | null>
      selectSavePath: (options?: { defaultPath?: string; filters?: Electron.FileFilter[] }) => Promise<string | null>
      selectFiles: (options?: Electron.OpenDialogOptions) => Promise<string[]>
      
      // R 函数相关
      getRFunctions: (packageName?: string, scriptPath?: string) => Promise<{
        success: boolean
        functions?: unknown[]
        error?: string
      }>
      callRFunction: (
        functionName: string,
        packageName: string | undefined,
        params: Record<string, unknown>,
        inputFiles: string[]
      ) => Promise<{ success: boolean; outputDir?: string; error?: string }>
      generateRFunctionScript: (
        functionName: string,
        packageName: string | undefined,
        params: Record<string, unknown>,
        inputFiles: string[]
      ) => Promise<{ success: boolean; outputDir?: string; script?: string; error?: string }>
      runRScript: (outputDir: string, scriptContent: string) => Promise<{ started?: boolean; success?: boolean; outputDir?: string; error?: string }>
      onRunRScriptResult: (callback: (result: { success: boolean; outputDir?: string; error?: string }) => void) => () => void
      cancelCurrentRScript: () => Promise<{ success: boolean }>
      runRFunctionRecorded: (
        functionName: string,
        packageName: string | undefined,
        params: Record<string, unknown>,
        inputFiles: string[]
      ) => Promise<{ success: boolean; outputDir?: string; recordId?: string; error?: string }>
      getRFunctionDoc: (functionName: string, packageName?: string) => Promise<{
        success: boolean
        documentation?: string
        detailedParameters?: unknown[]
        description?: string
        examples?: string
        error?: string
      }>

      // 函数文档管理相关
      getFunctionDocConfig: () => Promise<{ success: boolean; config?: unknown; error?: string }>
      saveFunctionDoc: (functionDoc: unknown) => Promise<{ success: boolean; error?: string }>
      deleteFunctionDoc: (functionName: string, packageName?: string) => Promise<{ success: boolean; error?: string }>
      getAllFunctionDocs: () => Promise<{ success: boolean; docs?: unknown[]; error?: string }>

      // R 包更新（从 GitHub 安装/更新）
      getRPackageUpdateList: () => Promise<{ success: boolean; packages?: string[]; error?: string }>
      installRPackageFromGitHub: (repo: string) => Promise<{ success: boolean; error?: string }>
      getGitHubToken: () => Promise<{ success: boolean; token?: string; error?: string }>
      setGitHubToken: (token: string) => Promise<{ success: boolean; error?: string }>

      // 运行记录
      getRunHistory: (limit?: number) => Promise<{ success: boolean; records?: unknown[]; error?: string }>
      getRunRecord: (id: string) => Promise<{ success: boolean; record?: unknown; error?: string }>
      deleteRunRecord: (id: string) => Promise<{ success: boolean; error?: string }>
      clearRunHistory: () => Promise<{ success: boolean; error?: string }>
      
      // 文件系统相关（用于结果查看）
      listFiles: (dir: string, options?: { extensions?: string[]; recursive?: boolean }) => Promise<{
        success: boolean
        files?: string[]
        error?: string
      }>
      copyFiles: (files: string[], targetDir: string) => Promise<{
        success: boolean
        files?: string[]
        error?: string
      }>
      convertPdfToImage: (pdfPath: string) => Promise<{
        success: boolean
        imagePath?: string
        error?: string
      }>
      convertPdfToSvg: (pdfPath: string) => Promise<{
        success: boolean
        svgPath?: string
        error?: string
      }>
      readImageAsDataUrl: (imagePath: string) => Promise<{
        success: boolean
        dataUrl?: string
        error?: string
      }>
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
      }) => Promise<{ success: boolean; imagePath?: string; error?: string; assembledCall?: string }>

      // Pipeline 配置相关
      getPipelineConfig: () => Promise<{
        success: boolean
        config?: unknown
        error?: string
      }>
      savePipelineConfig: (config: unknown) => Promise<{ success: boolean; error?: string }>

      // Git 仓库管理
      checkGitAvailable: () => Promise<{ available: boolean }>
  cloneGitRepository: (
    repoUrl: string,
    targetPath?: string,
    branch?: string,
    authOptions?: { sshKeyPath?: string; token?: string }
  ) => Promise<{
    success: boolean
    path?: string
    updated?: boolean
    error?: string
  }>
  updateGitRepository: (
    repoPath: string,
    branch?: string,
    authOptions?: { sshKeyPath?: string; token?: string }
  ) => Promise<{ success: boolean; error?: string }>
      addExternalPipelineDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>
      removeExternalPipelineDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>
    }
  }
}

export {}

