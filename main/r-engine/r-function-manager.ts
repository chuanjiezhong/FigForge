import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { getRscriptPath } from './rscript-path'

/**
 * R 函数信息
 */
export interface RFunctionInfo {
  name: string
  package?: string
  description?: string
  parameters?: string[]
}

/**
 * R 函数管理器
 * 用于获取 R 代码库中的函数列表
 */
export class RFunctionManager {
  /** 当前正在执行的 R 脚本进程（用于刷新/关闭时自动停止） */
  private currentScriptProcess: ChildProcess | null = null
  /** 是否由用户/取消触发的终止（用于 close 时返回「分析已取消」） */
  private killedByUser = false

  /**
   * 停止当前正在运行的 R 脚本（点击取消或刷新/关闭窗口时调用）
   */
  killCurrentRun(): void {
    console.log('[FigForge:r-manager] killCurrentRun 被调用, currentScriptProcess 存在?', !!this.currentScriptProcess, 'pid=', this.currentScriptProcess?.pid)
    if (this.currentScriptProcess) {
      this.killedByUser = true
      const proc = this.currentScriptProcess
      this.currentScriptProcess = null
      const pid = proc.pid
      try {
        if (process.platform === 'win32' && pid) {
          console.log('[FigForge:r-manager] Windows: taskkill /pid', pid)
          require('child_process').execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore', windowsHide: true })
        } else {
          console.log('[FigForge:r-manager] Unix: proc.kill(SIGTERM), pid=', pid)
          proc.kill('SIGTERM')
        }
        console.log('[FigForge:r-manager] kill 已执行')
      } catch (e) {
        console.log('[FigForge:r-manager] kill 异常', e)
        try {
          proc.kill()
          console.log('[FigForge:r-manager] fallback proc.kill() 已执行')
        } catch {
          // ignore
        }
      }
    } else {
      console.log('[FigForge:r-manager] 无当前进程，跳过')
    }
  }
  private escapeRString(s: string) {
    // 统一把 Windows 路径分隔符转成 /，并转义双引号，避免破坏 R 字符串
    return s.replace(/\\/g, '/').replace(/"/g, '\\"')
  }

  private toRValue(value: unknown): string {
    if (value === undefined || value === null) return 'NULL'
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return 'NULL'
      return String(value)
    }
    if (typeof value === 'string') return JSON.stringify(value) // 带引号并转义
    if (Array.isArray(value)) {
      const items = value.map((v) => this.toRValue(v)).join(', ')
      return `c(${items})`
    }
    if (typeof value === 'object') {
      // 复杂对象：转为 JSON，再用 jsonlite::fromJSON 解析成 list
      const json = JSON.stringify(value)
      return `jsonlite::fromJSON(${JSON.stringify(json)}, simplifyVector = FALSE)`
    }
    return 'NULL'
  }

  /**
   * 生成 R 函数调用脚本（不执行）
   */
  buildFunctionCallScript(
    functionName: string,
    packageName: string | undefined,
    params: Record<string, unknown>,
    inputFiles: string[],
    outputDir: string
  ): string {
    let rCode = ''

    // 加载包（如果指定）
    if (packageName) {
      const pkg = this.escapeRString(packageName)
      rCode += `library("${pkg}", character.only = TRUE)\n`
    }

    // 读取输入文件（兼容旧逻辑：input_0/input_1...）
    inputFiles.forEach((file, index) => {
      const safeFile = this.escapeRString(file)
      const ext = file.split('.').pop()?.toLowerCase()
      if (ext === 'rds') {
        rCode += `input_${index} <- readRDS("${safeFile}")\n`
      } else if (ext === 'txt' || ext === 'csv' || ext === 'tsv') {
        // 注意：必须写成 "\\t"（反斜杠+t），不能产生实际 tab 字符，否则 R 会报 unrecognized escape
        rCode += `input_${index} <- read.table("${safeFile}", header = TRUE, sep = ifelse(grepl("\\\\.csv$", "${safeFile}"), ",", "\\\\t"))\n`
      } else {
        rCode += `input_${index} <- readLines("${safeFile}")\n`
      }
    })

    // 构建函数调用参数
    const needsJsonlite = Object.values(params).some((v) => v && typeof v === 'object' && !Array.isArray(v))
    if (needsJsonlite) {
      rCode += `
        # 确保 jsonlite 可用（用于解析复杂参数）
        if (!requireNamespace("jsonlite", quietly = TRUE)) {
          install.packages("jsonlite", repos = "https://cran.rstudio.com/", quiet = TRUE)
        }
      `
    }

    const paramList = Object.entries(params)
      .filter(([key, v]) => key !== 'annotation_dataset_levels' && v !== undefined) // annotation_dataset_levels 仅前端可视化用，不传给 R
      .map(([key, value]) => {
        // color_gradient：R 端必须是 character 向量 c("blue", "green", ...)，不能是单个字符串
        if (key === 'color_gradient') {
          let arr: string[] = []
          if (Array.isArray(value)) {
            arr = value.filter((v) => typeof v === 'string').map((v) => String(v).trim()).filter(Boolean)
          } else if (typeof value === 'string') {
            arr = (value as string).split(',').map((s) => s.trim()).filter(Boolean)
          }
          if (arr.length > 0) {
            const rVec = arr.map((c) => JSON.stringify(c)).join(', ')
            return `${key} = c(${rVec})`
          }
        }
        // group_colors / id_colors：使用命名向量 c(Control="#D17C5B", Disease="#5B9BD5") 或 c(StudyA="#0072B2", StudyB="#D55E00")
        if ((key === 'group_colors' || key === 'id_colors') && value && typeof value === 'object' && !Array.isArray(value)) {
          const entries = Object.entries(value as Record<string, string>).filter(
            ([name, hex]) => String(name).trim() && String(hex).trim()
          )
          if (entries.length > 0) {
            const parts = entries
              .map(
                ([name, hex]) =>
                  `"${String(name).replace(/"/g, '\\"')}"=${JSON.stringify(String(hex).trim())}`
              )
              .join(', ')
            return `${key} = c(${parts})`
          }
        }
        // annotation_colors_list 必须是 R 表达式（list(...) 或 NULL），不能写成字符串，否则 R 端无法解析
        if (key === 'annotation_colors_list') {
          if (value === null || value === undefined) return `${key} = NULL`
          if (typeof value === 'string') {
            const t = value.trim()
            if (t === '' || t === 'NULL') return `${key} = NULL`
            if (t.startsWith('list(')) return `${key} = ${t}`
          }
          // 若前端误传对象，在此转为 R 表达式字符串再插入
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const obj = value as Record<string, Record<string, string>>
            const parts: string[] = []
            if (obj.group && typeof obj.group === 'object') {
              const ent = Object.entries(obj.group).filter(([, hex]) => hex)
              if (ent.length) parts.push(`Group=c(${ent.map(([k, h]) => `"${String(k).replace(/"/g, '\\"')}"="${h}"`).join(', ')})`)
            }
            if (obj.dataset && typeof obj.dataset === 'object') {
              const ent = Object.entries(obj.dataset).filter(([, hex]) => hex)
              if (ent.length) parts.push(`DataSet=c(${ent.map(([k, h]) => `"${String(k).replace(/"/g, '\\"')}"="${h}"`).join(', ')})`)
            }
            if (parts.length) return `${key} = list(${parts.join(', ')})`
            return `${key} = NULL`
          }
        }
        return `${key} = ${this.toRValue(value)}`
      })
      .join(', ')

    const inputParams = inputFiles
      .map((_, index) => `input_${index}`)
      .join(', ')

    const allParams = inputParams ?
      (paramList ? `${inputParams}, ${paramList}` : inputParams) :
      paramList

    const safeOutputDir = this.escapeRString(outputDir)

    rCode += `
      # 调用函数
      result <- ${functionName}(${allParams})

      # 保存结果（仅当 result 存在且可写时；绘图函数常返回 invisible(ggplot)，用 tryCatch 避免保存失败导致整段报错）
      if (exists("result") && !is.null(result)) {
        out_dir <- "${safeOutputDir}"
        if (!dir.exists(out_dir)) dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
        tryCatch({
          if (is.data.frame(result)) {
            write.table(result, file.path(out_dir, "result.txt"), row.names = FALSE, sep = "\\t")
          } else if (inherits(result, "ggplot")) {
            # 绘图函数返回的 ggplot 不必再写 result.rds，避免序列化失败或路径问题
            message("Plot object returned; result.rds not written.")
          } else if (is.list(result)) {
            saveRDS(result, file.path(out_dir, "result.rds"))
          } else {
            writeLines(as.character(result), file.path(out_dir, "result.txt"))
          }
        }, error = function(e) message("Save result failed: ", conditionMessage(e)))
      }
    `

    return rCode
  }

  /**
   * 直接执行一段 R 脚本内容
   * 会保存当前进程引用，便于刷新/关闭时自动停止
   */
  async runScriptFromContent(scriptContent: string, outputDir: string, fileName = 'call_function.R'): Promise<void> {
    console.log('[FigForge:r-manager] runScriptFromContent 开始')
    // 全局互斥：已有任务运行时不允许启动新的任务（由调用方决定是否先 cancel）
    if (this.currentScriptProcess) {
      console.log('[FigForge:r-manager] 已有任务在运行，拒绝启动新任务 pid=', this.currentScriptProcess?.pid)
      throw new Error('当前有任务正在运行，请先取消或等待完成')
    }
    this.killedByUser = false

    return new Promise((resolve, reject) => {
      const fs = require('fs-extra')
      const tempScript = join(outputDir, fileName)
      fs.writeFileSync(tempScript, scriptContent)

      const rscriptPath = getRscriptPath()
      const rProcess = spawn(rscriptPath, [tempScript], {
        cwd: outputDir,
        stdio: 'pipe',
      })
      this.currentScriptProcess = rProcess
      console.log('[FigForge:r-manager] R 进程已启动 pid=', rProcess.pid)

      let errorOutput = ''
      rProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString()
      })

      const cleanup = () => {
        if (this.currentScriptProcess === rProcess) {
          this.currentScriptProcess = null
        }
      }

      rProcess.on('close', (code, signal) => {
        const wasCancelled = this.killedByUser || signal === 'SIGTERM' || signal === 'SIGKILL'
        console.log('[FigForge:r-manager] R 进程 close: code=', code, 'signal=', signal, 'killedByUser=', this.killedByUser, 'wasCancelled=', wasCancelled)
        cleanup()
        this.killedByUser = false
        if (wasCancelled) {
          console.log('[FigForge:r-manager] 以「分析已取消」reject')
          reject(new Error('分析已取消'))
          return
        }
        if (code === 0) resolve()
        else reject(new Error(`R script failed: ${errorOutput}`))
      })

      rProcess.on('error', (error) => {
        console.log('[FigForge:r-manager] R 进程 error 事件', error)
        cleanup()
        this.killedByUser = false
        reject(error)
      })
    })
  }

  /**
   * 从 R 包中获取所有导出的函数
   */
  async getFunctionsFromPackage(packageName: string): Promise<RFunctionInfo[]> {
    return new Promise((resolve, reject) => {
      // 创建临时 R 脚本来获取函数列表
      const rScript = `
        # 检查并安装 jsonlite（如果需要）
        if (!requireNamespace("jsonlite", quietly = TRUE)) {
          install.packages("jsonlite", repos = "https://cran.rstudio.com/", quiet = TRUE)
        }
        
        if (!requireNamespace("${packageName}", quietly = TRUE)) {
          stop(paste0("Package ${packageName} not found. Please install it first: install.packages('${packageName}')"))
        }
        
        # 获取所有导出的函数
        funcs <- ls(getNamespace("${packageName}"))
        # 过滤掉非函数对象
        funcs <- funcs[sapply(funcs, function(x) {
          tryCatch({
            obj <- get(x, envir = getNamespace("${packageName}"))
            is.function(obj)
          }, error = function(e) FALSE)
        })]
        
        # 输出为 JSON
        result <- lapply(funcs, function(fname) {
          tryCatch({
            func <- get(fname, envir = getNamespace("${packageName}"))
            params <- tryCatch(names(formals(func)), error = function(e) character(0))
            list(
              name = fname,
              package = "${packageName}",
              parameters = params
            )
          }, error = function(e) {
            list(name = fname, package = "${packageName}", parameters = character(0))
          })
        })
        
        cat(jsonlite::toJSON(result, auto_unbox = TRUE))
      `

      const rscriptPath = getRscriptPath()
      const rProcess = spawn(rscriptPath, ['-e', rScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let output = ''
      let errorOutput = ''

      rProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      rProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString()
      })

      rProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const functions = JSON.parse(output) as RFunctionInfo[]
            resolve(functions)
          } catch (error) {
            reject(new Error(`Failed to parse R output: ${error}`))
          }
        } else {
          reject(new Error(`R script failed: ${errorOutput}`))
        }
      })

      rProcess.on('error', (error) => {
        reject(error)
      })
    })
  }

  /**
   * 从 R 脚本文件中获取函数列表
   */
  async getFunctionsFromScript(scriptPath: string): Promise<RFunctionInfo[]> {
    return new Promise((resolve, reject) => {
      const rScript = `
        # 检查并安装 jsonlite（如果需要）
        if (!requireNamespace("jsonlite", quietly = TRUE)) {
          install.packages("jsonlite", repos = "https://cran.rstudio.com/", quiet = TRUE)
        }
        
        # 加载脚本
        tryCatch({
          source("${scriptPath}", local = TRUE)
        }, error = function(e) {
          stop(paste0("Failed to source script: ", e$message))
        })
        
        # 获取当前环境中的所有函数
        funcs <- ls(envir = .GlobalEnv)
        funcs <- funcs[sapply(funcs, function(x) {
          tryCatch({
            obj <- get(x, envir = .GlobalEnv)
            is.function(obj)
          }, error = function(e) FALSE)
        })]
        
        # 输出为 JSON
        result <- lapply(funcs, function(fname) {
          tryCatch({
            func <- get(fname, envir = .GlobalEnv)
            params <- tryCatch(names(formals(func)), error = function(e) character(0))
            list(
              name = fname,
              parameters = params
            )
          }, error = function(e) {
            list(name = fname, parameters = character(0))
          })
        })
        
        cat(jsonlite::toJSON(result, auto_unbox = TRUE))
      `

      const rscriptPath = getRscriptPath()
      const rProcess = spawn(rscriptPath, ['-e', rScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let output = ''
      let errorOutput = ''

      rProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      rProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString()
      })

      rProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const functions = JSON.parse(output) as RFunctionInfo[]
            resolve(functions)
          } catch (error) {
            reject(new Error(`Failed to parse R output: ${error}`))
          }
        } else {
          reject(new Error(`R script failed: ${errorOutput}`))
        }
      })

      rProcess.on('error', (error) => {
        reject(error)
      })
    })
  }

  /**
   * 调用 R 函数
   */
  async callFunction(
    functionName: string,
    packageName: string | undefined,
    params: Record<string, unknown>,
    inputFiles: string[],
    outputDir: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // 创建临时 R 脚本
      const tempScript = join(outputDir, 'call_function.R')
      const fs = require('fs-extra')

      const rCode = this.buildFunctionCallScript(functionName, packageName, params, inputFiles, outputDir)
      
      fs.writeFileSync(tempScript, rCode)
      
      const rProcess = spawn('Rscript', [tempScript], {
        cwd: outputDir,
        stdio: 'pipe',
      })

      let errorOutput = ''

      rProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString()
      })

      rProcess.on('close', (code) => {
        if (code === 0) {
          resolve(outputDir)
        } else {
          reject(new Error(`R function call failed: ${errorOutput}`))
        }
      })

      rProcess.on('error', (error) => {
        reject(error)
      })
    })
  }

  /**
   * 获取 R 函数的文档
   */
  async getFunctionDocumentation(functionName: string, packageName?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // 安全地处理 packageName，避免 undefined 被转换为字符串
      const pkgName = packageName && packageName !== 'undefined' ? packageName : ''
      const hasPackage = pkgName && pkgName.length > 0
      
      const rScript = `
        # 加载包（如果指定）
        ${hasPackage ? `
        if (!requireNamespace("${pkgName}", quietly = TRUE)) {
          stop(paste0("Package ${pkgName} not found"))
        }
        library("${pkgName}", character.only = TRUE)
        ` : ''}
        
        # 获取函数文档
        result <- tryCatch({
          # 方法1: 尝试使用 tools::Rd2txt() 获取格式化的文本文档
          ${hasPackage ? `
          pkg_path <- find.package("${pkgName}")
          man_dir <- file.path(pkg_path, "man")
          
          # 查找对应的 Rd 文件（可能包含函数名或别名）
          rd_files <- list.files(man_dir, pattern = "\\.Rd$", full.names = TRUE)
          target_file <- NULL
          
          for (rd_file in rd_files) {
            rd_content <- readLines(rd_file, warn = FALSE, n = 50)
            # 检查是否包含函数名（检查 \\alias{functionName} 或 \\name{functionName}）
            if (any(grepl(paste0("\\\\alias\\{", "${functionName}", "\\}"), rd_content)) || 
                any(grepl(paste0("\\\\name\\{", "${functionName}", "\\}"), rd_content))) {
              target_file <- rd_file
              break
            }
          }
          
          if (!is.null(target_file)) {
            # 解析并转换为文本
            rd <- tools::parse_Rd(target_file)
            temp_file <- tempfile(fileext = ".txt")
            tools::Rd2txt(rd, out = temp_file, package = ${hasPackage ? `"${pkgName}"` : 'NULL'})
            
            if (file.exists(temp_file)) {
              content <- readLines(temp_file, warn = FALSE, encoding = "UTF-8")
              content <- paste(content, collapse = "\\n")
              unlink(temp_file)
              content
            } else {
              NULL
            }
          } else {
            NULL
          }
          ` : 'NULL'}
        }, error = function(e) {
          NULL
        })
        
        # 如果方法1失败，尝试方法2
        if (is.null(result)) {
          result <- tryCatch({
            # 方法2: 使用 capture.output 获取帮助文档
            doc_text <- capture.output({
              ${hasPackage ? `help("${functionName}", package = "${pkgName}")` : `help("${functionName}")`}
            })
            
            if (length(doc_text) > 0) {
              # 移除控制字符
              doc_text <- gsub("[[:cntrl:]]", "", doc_text)
              # 合并为字符串
              paste(doc_text, collapse = "\\n")
            } else {
              NULL
            }
          }, error = function(e) {
            NULL
          })
        }
        
        # 如果方法2也失败，尝试方法3：构建基本文档
        if (is.null(result)) {
          result <- tryCatch({
            func_env <- ${hasPackage ? `asNamespace("${pkgName}")` : '.GlobalEnv'}
            func <- get("${functionName}", envir = func_env)
            params <- names(formals(func))
            param_details <- formals(func)
            
            doc_parts <- c(
              paste0("函数名称: ${functionName}"),
              ${hasPackage ? `paste0("包: ${pkgName}")` : 'NULL'},
              "",
              "用法:",
              paste0("  ${functionName}(", paste(params, collapse = ", "), ")"),
              "",
              "参数:"
            )
            
            for (param in params) {
              default_val <- param_details[[param]]
              if (is.name(default_val) && as.character(default_val) == "") {
                doc_parts <- c(doc_parts, paste0("  ", param, ": (必需)"))
              } else {
                doc_parts <- c(doc_parts, paste0("  ", param, ": (默认值: ", deparse(default_val), ")"))
              }
            }
            
            paste(doc_parts, collapse = "\\n")
          }, error = function(e) {
            NULL
          })
        }
        
        # 输出结果
        if (!is.null(result) && nchar(result) > 0) {
          cat(result)
        } else {
          cat("暂无文档")
        }
      `

      const rscriptPath = getRscriptPath()
      const rProcess = spawn(rscriptPath, ['-e', rScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let output = ''
      let errorOutput = ''

      rProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      rProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString()
      })

      rProcess.on('close', (code) => {
        // 即使返回码不为0，如果有输出也尝试使用
        if (output.trim().length > 0) {
          resolve(output.trim())
        } else if (code === 0) {
          // 如果返回码为0但没有输出，可能是真的没有文档
          resolve('暂无文档')
        } else {
          // 有错误且没有输出
          console.error('R script error:', errorOutput)
          reject(new Error(`Failed to get documentation: ${errorOutput || 'Unknown error'}`))
        }
      })

      rProcess.on('error', (error) => {
        reject(error)
      })
    })
  }

  /**
   * 调用 R 表达式并解析 JSON 输出（stdout 必须是 JSON）
   */
  async evalToJson<T = unknown>(rExpression: string, packageName?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const pkgName = packageName && packageName !== 'undefined' ? packageName : ''
      const hasPackage = pkgName && pkgName.length > 0
      const expr = rExpression.replace(/`/g, '\\`')

      const rScript = `
        if (!requireNamespace("jsonlite", quietly = TRUE)) {
          install.packages("jsonlite", repos = "https://cran.rstudio.com/", quiet = TRUE)
        }
        ${hasPackage ? `
        if (!requireNamespace("${pkgName}", quietly = TRUE)) {
          stop(paste0("Package ${pkgName} not found"))
        }
        library("${pkgName}", character.only = TRUE)
        ` : ''}
        result <- (${expr})
        cat(jsonlite::toJSON(result, auto_unbox = TRUE, null = "null"))
      `

      const rscriptPath = getRscriptPath()
      const rProcess = spawn(rscriptPath, ['-e', rScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let output = ''
      let errorOutput = ''

      rProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      rProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString()
      })

      rProcess.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(output) as T)
          } catch (e) {
            reject(new Error(`Failed to parse R JSON output: ${String(e)}\nraw=${output}`))
          }
        } else {
          reject(new Error(`R script failed: ${errorOutput}`))
        }
      })

      rProcess.on('error', (error) => reject(error))
    })
  }
}

