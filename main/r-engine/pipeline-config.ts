import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'

/**
 * 展开路径（支持 ~ 符号）
 */
function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir())
  }
  return resolve(path)
}

/**
 * Pipeline 配置管理
 * 支持本地和外部 GitHub 仓库的 R 代码
 */
export interface PipelineConfig {
  // 本地 pipelines 目录（默认）
  localPipelinesDir?: string
  
  // 外部 pipelines 目录列表（可以是 Git 仓库克隆后的路径）
  externalPipelinesDirs?: string[]
  
  // GitHub 仓库配置（可选，用于自动克隆）
  gitRepositories?: Array<{
    url: string
    branch?: string
    localPath: string
    autoUpdate?: boolean
    // 认证配置
    auth?: {
      // SSH 密钥路径（用于 SSH URL）
      sshKeyPath?: string
      // Personal Access Token（用于 HTTPS URL）
      token?: string
    }
  }>
  
  // 全局 Git 认证配置（可选）
  gitAuth?: {
    // 默认 SSH 密钥路径
    defaultSshKeyPath?: string
    // 默认 Personal Access Token
    defaultToken?: string
  }
}

/**
 * 获取配置文件路径
 * 打包后：用户数据目录（~/.config/FigForge/pipeline-config.json 或 ~/Library/Application Support/FigForge/）
 * 开发时：项目根目录
 */
function getConfigFilePath(): string {
  try {
    // 尝试使用 electron app（仅在主进程中可用）
    if (typeof require !== 'undefined') {
      const { app } = require('electron')
      if (app && app.isPackaged) {
        // 打包后，配置文件保存在用户数据目录
        return join(app.getPath('userData'), 'pipeline-config.json')
      }
    }
  } catch {
    // 如果不在 Electron 环境中，使用项目目录
  }
  
  // 开发环境或非 Electron 环境
  return join(__dirname, '../../pipeline-config.json')
}

const CONFIG_FILE = getConfigFilePath()

/**
 * 读取 Pipeline 配置
 */
export async function loadPipelineConfig(): Promise<PipelineConfig> {
  try {
    if (existsSync(CONFIG_FILE)) {
      const configContent = await readFile(CONFIG_FILE, 'utf-8')
      return JSON.parse(configContent) as PipelineConfig
    }
  } catch (error) {
    console.error('Failed to load pipeline config:', error)
  }
  
  // 默认配置
  // 打包后，本地 pipelines 目录在 app.asar 中
  const localPipelinesDir = (() => {
    try {
      if (typeof require !== 'undefined') {
        const { app } = require('electron')
        if (app && app.isPackaged) {
          // 打包后，pipelines 在 app.asar 中
          return join(app.getAppPath(), 'pipelines')
        }
      }
    } catch {
      // 忽略错误
    }
    // 开发环境
    return join(__dirname, '../../pipelines')
  })()

  return {
    localPipelinesDir,
    externalPipelinesDirs: [],
    gitRepositories: [],
  }
}

/**
 * 获取所有 pipelines 目录
 */
export async function getAllPipelinesDirs(): Promise<string[]> {
  const config = await loadPipelineConfig()
  const dirs: string[] = []
  
  // 添加本地目录
  if (config.localPipelinesDir) {
    const expandedPath = expandPath(config.localPipelinesDir)
    if (existsSync(expandedPath)) {
      dirs.push(expandedPath)
    }
  }
  
  // 添加外部目录
  if (config.externalPipelinesDirs) {
    for (const dir of config.externalPipelinesDirs) {
      const expandedPath = expandPath(dir)
      if (existsSync(expandedPath)) {
        dirs.push(expandedPath)
      } else {
        console.warn(`External pipeline directory not found: ${dir} (expanded: ${expandedPath})`)
      }
    }
  }
  
  return dirs
}

/**
 * 保存 Pipeline 配置
 */
export async function savePipelineConfig(config: PipelineConfig): Promise<void> {
  try {
    await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to save pipeline config:', error)
    throw error
  }
}

/**
 * 添加外部 Pipeline 目录
 */
export async function addExternalPipelineDir(dirPath: string): Promise<void> {
  const config = await loadPipelineConfig()
  if (!config.externalPipelinesDirs) {
    config.externalPipelinesDirs = []
  }
  
  const expandedPath = expandPath(dirPath)
  if (!config.externalPipelinesDirs.includes(expandedPath)) {
    config.externalPipelinesDirs.push(expandedPath)
    await savePipelineConfig(config)
  }
}

/**
 * 移除外部 Pipeline 目录
 */
export async function removeExternalPipelineDir(dirPath: string): Promise<void> {
  const config = await loadPipelineConfig()
  if (!config.externalPipelinesDirs) {
    return
  }
  
  const expandedPath = expandPath(dirPath)
  config.externalPipelinesDirs = config.externalPipelinesDirs.filter(
    (dir) => expandPath(dir) !== expandedPath
  )
  await savePipelineConfig(config)
}

