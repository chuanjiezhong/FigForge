import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * 函数文档配置
 */
export type ParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'file'
  | 'directory'
  | 'select'
  | 'text'
  | 'color'
  | 'colorGradient'
  | 'groupColors'
  | 'tags'

export interface FunctionDocEntry {
  name: string
  /** 分类标识（英文）：transcriptomics | metabolomics | single_cell | proteomics */
  category?: string
  /** 可选：用于“从 RDS 重绘”的函数名（与绘图主函数解耦） */
  redrawFunction?: string
  /** 可选：重绘参数配置（用于前端动态渲染重绘面板） */
  redrawParameters?: Array<{
    name: string
    type?: string
    required?: boolean
    default?: unknown
    options?: string[]
    placeholder?: string
    min?: number
    max?: number
  }>
  description?: string
  documentation?: string
  examples?: string
  detailedParameters?: Array<{
    name: string
    type: ParameterType
    description?: string
    required?: boolean
    default?: unknown
    options?: string[]
    placeholder?: string
    min?: number
    max?: number
  }>
  version?: string
  author?: string
}

export interface FunctionDocConfigV2 {
  titles: Array<{
    title: string
    packages: Array<{
      package: string
      functions: FunctionDocEntry[]
    }>
  }>
}

export interface FunctionDocConfigV3 {
  packages: Array<{
    package: string
    functions: FunctionDocEntry[]
  }>
  /** 可从 GitHub 更新的 R 包列表（repo 格式：owner/repo） */
  githubPackages?: string[]
}

// 旧版本（兼容导入/读取）
export interface FunctionDocConfigV1 {
  functions: Array<
    FunctionDocEntry & {
      package?: string
      title?: string
    }
  >
}

export type FunctionDocConfig = FunctionDocConfigV3

/**
 * 获取配置文件路径
 */
function getConfigFilePath(): string {
  try {
    // 尝试使用 electron app（仅在主进程中可用）
    if (typeof require !== 'undefined') {
      const { app } = require('electron')
      if (app && app.isPackaged) {
        // 打包后，配置文件保存在用户数据目录
        return join(app.getPath('userData'), 'function-docs.json')
      }
    }
  } catch {
    // 如果不在 Electron 环境中，使用项目目录
  }
  
  // 开发环境或非 Electron 环境
  return join(__dirname, '../../function-docs.json')
}

/**
 * 函数文档管理器
 */
export class FunctionDocsManager {
  private configPath: string

  constructor() {
    this.configPath = getConfigFilePath()
  }

  private normalizeConfig(raw: unknown): FunctionDocConfigV3 {
    // v3: { packages: [...] } —— 你希望的最终结构
    if (
      raw &&
      typeof raw === 'object' &&
      Array.isArray((raw as any).packages)
    ) {
      const packages = (raw as any).packages as FunctionDocConfigV3['packages']
      const githubPackages = Array.isArray((raw as any).githubPackages)
        ? (raw as any).githubPackages.filter((x: unknown) => typeof x === 'string')
        : undefined
      return {
        packages: (packages || [])
          .filter((p: any) => p && typeof p.package === 'string' && Array.isArray(p.functions))
          .map((p: any) => ({
            package: p.package,
            functions: (p.functions || []).filter((f: any) => f && typeof f.name === 'string'),
          })),
        githubPackages: githubPackages?.length ? githubPackages : undefined,
      }
    }

    // v2: { titles: [...] }
    if (
      raw &&
      typeof raw === 'object' &&
      Array.isArray((raw as any).titles)
    ) {
      const titles = (raw as any).titles as FunctionDocConfigV2['titles']
      const pkgMap = new Map<string, FunctionDocEntry[]>()
      for (const t of titles || []) {
        for (const p of (t as any).packages || []) {
          const pkg = p?.package
          if (typeof pkg !== 'string') continue
          const funcs = Array.isArray(p.functions) ? p.functions : []
          const arr = pkgMap.get(pkg) ?? []
          for (const f of funcs) {
            if (f && typeof f.name === 'string') arr.push(f)
          }
          pkgMap.set(pkg, arr)
        }
      }
      return {
        packages: Array.from(pkgMap.entries()).map(([pkg, funcs]) => ({
          package: pkg,
          functions: funcs,
        })),
      }
    }

    // v1: { functions: [...] }
    if (
      raw &&
      typeof raw === 'object' &&
      Array.isArray((raw as any).functions)
    ) {
      const v1 = raw as FunctionDocConfigV1
      const pkgMap = new Map<string, FunctionDocEntry[]>() // package -> entries

      for (const f of v1.functions || []) {
        if (!f || typeof f.name !== 'string') continue
        const pkg = (f as any).package && typeof (f as any).package === 'string' ? (f as any).package : '未指定包'

        const arr = pkgMap.get(pkg) ?? []
        const entry: FunctionDocEntry = {
          name: f.name,
          description: f.description,
          documentation: f.documentation,
          examples: f.examples,
          detailedParameters: f.detailedParameters,
          version: f.version,
          author: f.author,
        }
        arr.push(entry)
        pkgMap.set(pkg, arr)
      }

      return {
        packages: Array.from(pkgMap.entries()).map(([pkg, funcs]) => ({
          package: pkg,
          functions: funcs,
        })),
      }
    }

    return { packages: [] }
  }

  /**
   * 打包后内置默认配置路径（app.asar 根目录）
   */
  private getBundledConfigPath(): string | null {
    try {
      if (typeof require !== 'undefined') {
        const { app } = require('electron')
        if (app && app.isPackaged) {
          return join(app.getAppPath(), 'app.asar', 'function-docs.json')
        }
      }
    } catch {
      // 忽略
    }
    return null
  }

  /**
   * 加载函数文档配置
   * 打包后：若 userData 里没有有效配置（空或不存在），则回退到内置 function-docs.json
   */
  loadConfig(): FunctionDocConfig {
    try {
      // 1) 用户配置（userData 或开发时的项目路径）
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf-8')
        const userConfig = this.normalizeConfig(JSON.parse(content))
        // 打包后：若用户配置为空（无函数），回退到内置默认，避免“暂无函数”
        if (userConfig.packages.length > 0) {
          return userConfig
        }
        const bundledPath = this.getBundledConfigPath()
        if (bundledPath && existsSync(bundledPath)) {
          const bundledContent = readFileSync(bundledPath, 'utf-8')
          const bundled = this.normalizeConfig(JSON.parse(bundledContent))
          if (bundled.packages.length > 0) {
            return bundled
          }
        }
        return userConfig
      }

      // 2) 无用户文件时：打包后读内置默认
      const bundledPath = this.getBundledConfigPath()
      if (bundledPath && existsSync(bundledPath)) {
        const content = readFileSync(bundledPath, 'utf-8')
        return this.normalizeConfig(JSON.parse(content))
      }
    } catch (error) {
      console.error('Failed to load function docs config:', error)
    }

    return { packages: [] }
  }

  /**
   * 保存函数文档配置
   */
  saveConfig(config: FunctionDocConfig): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save function docs config:', error)
      throw error
    }
  }

  /**
   * 获取函数的文档信息
   */
  getFunctionDoc(functionName: string, packageName?: string): {
    documentation?: string
    detailedParameters?: Array<{
      name: string
      type: string
      description?: string
      required?: boolean
      default?: unknown
      options?: string[]
      placeholder?: string
      min?: number
      max?: number
    }>
    description?: string
    examples?: string
  } | null {
    const config = this.loadConfig()
    
    let exact: FunctionDocEntry | null = null
    let fallback: FunctionDocEntry | null = null

    for (const p of config.packages) {
      for (const f of p.functions) {
        if (f.name !== functionName) continue
        if (packageName && p.package === packageName) exact = f
        if (!fallback) fallback = f
      }
    }

    const functionDoc = exact || fallback

    if (!functionDoc) {
      return null
    }

    return {
      documentation: functionDoc.documentation,
      detailedParameters: functionDoc.detailedParameters,
      description: functionDoc.description,
      examples: functionDoc.examples,
    }
  }

  /**
   * 添加或更新函数文档
   */
  upsertFunctionDoc(functionDoc: unknown): void {
    const config = this.loadConfig()

    // 扁平结构：{ package, name, ... }（title 忽略）
    const doc = functionDoc as any
    const pkg: string = typeof doc?.package === 'string' && doc.package.trim() ? doc.package.trim() : '未指定包'
    const name: string = typeof doc?.name === 'string' ? doc.name : ''
    if (!name) throw new Error('Function name is required')

    const entry: FunctionDocEntry = {
      name,
      category: doc.category,
      redrawFunction: doc.redrawFunction,
      redrawParameters: doc.redrawParameters,
      description: doc.description,
      documentation: doc.documentation,
      examples: doc.examples,
      detailedParameters: doc.detailedParameters,
      version: doc.version,
      author: doc.author,
    }

    const pIdx = config.packages.findIndex((p) => p.package === pkg)
    if (pIdx === -1) {
      config.packages.push({ package: pkg, functions: [entry] })
      this.saveConfig(config)
      return
    }

    const pkgGroup = config.packages[pIdx]
    const fIdx = pkgGroup.functions.findIndex((f) => f.name === name)
    if (fIdx >= 0) pkgGroup.functions[fIdx] = entry
    else pkgGroup.functions.push(entry)

    this.saveConfig(config)
  }

  /**
   * 删除函数文档
   */
  deleteFunctionDoc(functionName: string, packageName?: string): void {
    const config = this.loadConfig()

    for (const p of config.packages) {
      if (packageName && p.package !== packageName) continue
      p.functions = p.functions.filter((f) => f.name !== functionName)
    }
    config.packages = config.packages.filter((p) => p.functions.length > 0)

    this.saveConfig(config)
  }

  /**
   * 获取所有函数文档列表
   */
  getAllFunctionDocs(): Array<FunctionDocEntry & { package: string }> {
    const config = this.loadConfig()
    const out: Array<FunctionDocEntry & { package: string }> = []
    for (const p of config.packages) {
      for (const f of p.functions) {
        out.push({ ...f, package: p.package })
      }
    }
    return out
  }

  /**
   * 获取可从 GitHub 更新的 R 包列表（repo 格式：owner/repo）
   */
  getGithubPackages(): string[] {
    const config = this.loadConfig()
    if (config.githubPackages && config.githubPackages.length > 0) {
      return config.githubPackages
    }
    return ['chuanjiezhong/OmicsFlowCoreFullVersion']
  }
}
