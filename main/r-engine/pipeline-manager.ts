import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { getAllPipelinesDirs } from './pipeline-config'

export interface PipelineInfo {
  id: string
  name: string
  description?: string
  version: string
  path: string
  source?: string // 来源：'local' | 'external' | 'git'
}

export class PipelineManager {
  /**
   * 获取所有可用的 Pipeline
   * 支持从多个目录（本地和外部）加载
   */
  async listPipelines(): Promise<PipelineInfo[]> {
    const pipelines: PipelineInfo[] = []
    const pipelinesDirs = await getAllPipelinesDirs()
    
    // 从每个目录加载 pipelines
    for (const pipelinesDir of pipelinesDirs) {
      try {
        const entries = await readdir(pipelinesDir)
        
        for (const entry of entries) {
          const entryPath = join(pipelinesDir, entry)
          const stats = await stat(entryPath)
          
          if (stats.isDirectory()) {
            // 生成唯一 ID（包含来源信息）
            const source = pipelinesDir.includes('pipelines') && !pipelinesDir.includes('external') 
              ? 'local' 
              : 'external'
            const pipelineId = `${source}_${entry}`
            
            // 检查是否已存在（避免重复）
            if (pipelines.find(p => p.id === pipelineId)) {
              continue
            }
            
            // 尝试读取 pipeline 信息
            const infoPath = join(entryPath, 'pipeline.json')
            try {
              const fs = require('fs-extra')
              const info = await fs.readJson(infoPath)
              pipelines.push({
                id: pipelineId,
                name: info.name || entry,
                description: info.description,
                version: info.version || '1.0.0',
                path: entryPath,
                source,
              })
            } catch {
              // 如果没有 pipeline.json，使用默认信息
              pipelines.push({
                id: pipelineId,
                name: entry,
                version: '1.0.0',
                path: entryPath,
                source,
              })
            }
          }
        }
      } catch (error) {
        console.error(`Error listing pipelines from ${pipelinesDir}:`, error)
      }
    }

    return pipelines
  }

  /**
   * 获取 Pipeline 信息
   */
  async getPipelineInfo(pipelineId: string): Promise<PipelineInfo | null> {
    const pipelines = await this.listPipelines()
    return pipelines.find((p) => p.id === pipelineId) || null
  }
}

