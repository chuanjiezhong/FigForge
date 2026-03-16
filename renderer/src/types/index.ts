// 通用类型定义

export interface Panel {
  id: string
  type: 'svg' | 'png' | 'tiff'
  path: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX?: number
  scaleY?: number
}

export interface LayoutData {
  panels: Panel[]
  width: number
  height: number
  backgroundColor?: string
}

export interface PipelineParams {
  [key: string]: unknown
}

export interface PipelineResult {
  jobId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  logs: string[]
  resultPath?: string
  error?: string
}

