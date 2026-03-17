/**
 * Pipeline 配置类型定义
 */
export interface PipelineConfig {
  // R 包名称（可选）
  packageName?: string
  // R 脚本路径（可选）
  scriptPath?: string
}

/**
 * 参数类型枚举
 */
export type ParameterType = 
  | 'string'      // 字符串
  | 'number'      // 数字
  | 'boolean'     // 布尔值
  | 'array'       // 数组
  | 'file'        // 文件路径
  | 'directory'   // 目录路径
  | 'select'      // 下拉选择
  | 'text'        // 多行文本
  | 'color'       // 单色（颜色选择器，值为 hex 如 #D17C5B）
  | 'colorGradient'  // 颜色渐变（多个颜色，逗号分隔，用 Ant Design ColorPicker）
  | 'groupColors' // 分组配色（分组标签 -> 颜色）
  | 'tags'        // 可搜索、可输入，选中后以标签显示（如比较组 contrast）
  | 'annotationColors'  // 注释列颜色：根据 contrast 等字段展示各组的颜色配置（Group 等）

/**
 * 函数参数详细信息
 */
export interface ParameterInfo {
  name: string                    // 参数名
  type: ParameterType            // 参数类型
  description?: string           // 参数描述
  required?: boolean             // 是否必需
  default?: unknown              // 默认值
  options?: string[]             // 选项列表（用于select类型）
  placeholder?: string           // 占位符文本
  min?: number                   // 最小值（用于number类型）
  max?: number                   // 最大值（用于number类型）
}

/**
 * R 函数信息
 */
/** 函数分类标识（英文）：transcriptomics, metabolomics, single_cell, proteomics */
export type FunctionCategory = 'transcriptomics' | 'metabolomics' | 'single_cell' | 'proteomics'

export interface RFunctionInfo {
  name: string
  title?: string
  package?: string
  /** 分类标识（英文）：transcriptomics | metabolomics | single_cell | proteomics */
  category?: string
  description?: string
  parameters?: string[]          // 简单参数列表（向后兼容）
  detailedParameters?: ParameterInfo[]  // 详细参数信息
  documentation?: string         // 函数文档
  examples?: string              // 使用示例
  version?: string               // 函数版本
  author?: string                // 作者
}

