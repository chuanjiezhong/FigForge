import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { getRscriptPath } from './rscript-path'
import { EventEmitter } from 'events'

export interface RPipelineResult {
  jobId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  logs: string[]
  resultPath?: string
  error?: string
}

export class RProcessor extends EventEmitter {
  private processes: Map<string, ChildProcess> = new Map()

  /**
   * 运行 R Pipeline
   * 支持从本地或外部目录运行
   */
  async runPipeline(
    pipelineId: string,
    params: Record<string, unknown>,
    outputDir: string,
    pipelinePath?: string // 可选的 pipeline 路径
  ): Promise<string> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // 确定 R 脚本路径
    let scriptPath: string
    let pipelineDir: string
    
    if (pipelinePath) {
      // 使用提供的路径（可能来自外部仓库）
      pipelineDir = pipelinePath
      scriptPath = join(pipelinePath, 'main.R')
    } else {
      // 默认路径（兼容旧代码）
      // 处理 pipelineId 可能包含 source 前缀的情况
      const actualId = pipelineId.includes('_') ? pipelineId.split('_').slice(1).join('_') : pipelineId
      pipelineDir = join(__dirname, '../../pipelines', actualId)
      scriptPath = join(pipelineDir, 'main.R')
    }

    // 将参数写入临时 JSON 文件
    const paramsPath = join(outputDir, 'params.json')
    const fs = require('fs-extra')
    await fs.writeJson(paramsPath, params, { spaces: 2 })

    // 启动 Rscript 进程（使用解析后的路径，打包后从 Finder 启动时 PATH 可能不含 R）
    const rscriptPath = getRscriptPath()
    // macOS/Linux：GUI 启动时 locale 可能不是 UTF-8，导致 R 无法正确解码中文路径
    const env = process.platform === 'win32'
      ? process.env
      : {
          ...process.env,
          LANG: process.env.LANG || 'C.UTF-8',
          LC_ALL: process.env.LC_ALL || 'C.UTF-8',
          LC_CTYPE: process.env.LC_CTYPE || 'C.UTF-8',
        }
    const rProcess = spawn(rscriptPath, [scriptPath, paramsPath, outputDir], {
      cwd: pipelineDir,
      env,
    })

    this.processes.set(jobId, rProcess)

    // 处理输出
    let logs: string[] = []
    rProcess.stdout?.on('data', (data) => {
      const log = data.toString()
      logs.push(log)
      this.emit('log', { jobId, log })
    })

    rProcess.stderr?.on('data', (data) => {
      const log = data.toString()
      logs.push(log)
      this.emit('log', { jobId, log })
    })

    // 处理完成
    rProcess.on('close', (code) => {
      this.processes.delete(jobId)
      if (code === 0) {
        this.emit('complete', { jobId, outputDir })
      } else {
        this.emit('error', { jobId, error: `R script exited with code ${code}` })
      }
    })

    return jobId
  }

  /**
   * 取消 Pipeline
   */
  cancelPipeline(jobId: string): boolean {
    const process = this.processes.get(jobId)
    if (process) {
      process.kill()
      this.processes.delete(jobId)
      this.emit('cancelled', { jobId })
      return true
    }
    return false
  }

  /**
   * 获取 Pipeline 状态
   */
  getPipelineStatus(jobId: string): 'running' | 'not-found' {
    return this.processes.has(jobId) ? 'running' : 'not-found'
  }
}

