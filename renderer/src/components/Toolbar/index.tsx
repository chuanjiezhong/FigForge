import { useState } from 'react'
import { Button, Space, message, Spin } from 'antd'
import {
  PlayCircleOutlined,
  StopOutlined,
  ExportOutlined,
  SaveOutlined,
  FileTextOutlined,
  HistoryOutlined,
} from '@ant-design/icons'
import FunctionDocEditor from '../FunctionDocEditor'
import RunHistory from '../RunHistory'
import styles from './index.module.less'

interface ToolbarProps {
  activeTab?: 'functions' | 'canvas'
  running?: boolean
  onRunAnalysis?: () => void
  onExport?: () => void
  onSave?: () => void
  /** 从运行记录点击「编辑」时：跳转画布并把该图加到画布（含 rdsFile、sourceParams） */
  onEditImageInCanvas?: (imagePath: string, source: { outputDir: string; functionName?: string; packageName?: string; rdsFile?: string; sourceParams?: Record<string, unknown> }) => void
}

function Toolbar({ activeTab = 'functions', running = false, onRunAnalysis, onExport, onSave, onEditImageInCanvas }: ToolbarProps) {
  const [docEditorVisible, setDocEditorVisible] = useState(false)
  const [historyVisible, setHistoryVisible] = useState(false)

  const handleRunAnalysis = () => {
    if (onRunAnalysis) {
      onRunAnalysis()
    } else {
      message.info('请在函数详情页面运行分析')
    }
  }

  const handleExport = () => {
    if (onExport) {
      onExport()
    } else {
      message.info('请在画布视图导出')
    }
  }

  const handleSave = () => {
    if (onSave) {
      onSave()
    } else {
      message.info('请在画布视图保存')
    }
  }

  const handleCancelAnalysis = () => {
    console.log('[FigForge:renderer] 点击取消分析')
    const api = window.electronAPI as Record<string, unknown>
    console.log('[FigForge:renderer] electronAPI 上的方法:', api ? Object.keys(api).filter(k => typeof api[k] === 'function').sort() : '无')
    const hasApi = typeof api?.cancelCurrentRScript === 'function'
    console.log('[FigForge:renderer] cancelCurrentRScript 存在?', hasApi)
    if (hasApi) {
      ;(api.cancelCurrentRScript as () => Promise<unknown>)().then(
        (r) => console.log('[FigForge:renderer] cancelCurrentRScript 返回', r),
        (e) => console.log('[FigForge:renderer] cancelCurrentRScript 失败', e)
      )
      message.info('正在取消分析…')
    } else {
      console.warn('[FigForge:renderer] cancelCurrentRScript 未暴露。请完全退出 FigForge 后重新运行 yarn dev 以加载最新 preload。')
      message.warning('取消功能未就绪，请重启应用后重试')
    }
  }

  return (
    <>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>FigForge</h1>
        <div className={styles.actions}>
          {running && (
            <span className={styles.runningHint}>
              <Spin size="small" style={{ marginRight: 8 }} />
              正在分析中…
            </span>
          )}
          <Space>
            {activeTab === 'functions' ? (
              <>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleRunAnalysis}
                  disabled={running}
                >
                  运行分析
                </Button>
                {running && (
                  <Button
                    danger
                    icon={<StopOutlined />}
                    onClick={handleCancelAnalysis}
                  >
                    取消分析
                  </Button>
                )}
                <Button
                  icon={<FileTextOutlined />}
                  onClick={() => setDocEditorVisible(true)}
                >
                  函数文档
                </Button>
                <Button
                  icon={<HistoryOutlined />}
                  onClick={() => setHistoryVisible(true)}
                >
                  运行记录
                </Button>
              </>
            ) : (
              <>
                <Button icon={<ExportOutlined />} onClick={handleExport}>
                  导出
                </Button>
                <Button icon={<SaveOutlined />} onClick={handleSave}>
                  保存
                </Button>
              </>
            )}
          </Space>
        </div>
      </div>
      <FunctionDocEditor
        open={docEditorVisible}
        onClose={() => setDocEditorVisible(false)}
      />
      <RunHistory
        open={historyVisible}
        onClose={() => setHistoryVisible(false)}
        onEditImageInCanvas={onEditImageInCanvas}
      />
    </>
  )
}

export default Toolbar

