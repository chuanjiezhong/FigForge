import { Layout, Tabs, Modal, Select, Form, InputNumber, Progress, Drawer, Typography, List, Spin, Tour, Button } from 'antd'
import { useState, useEffect, useCallback, useRef } from 'react'
import { FunctionOutlined, EditOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import FunctionList from './components/FunctionList'
import FunctionDetail from './components/FunctionDetail'
import ResultView from './components/ResultView'
import Toolbar from './components/Toolbar'
import PipelineView from './components/PipelineView'
import styles from './App.module.less'
import type { RFunctionInfo } from './types/pipeline'
import { message } from 'antd'
import { addRunRecord, newRunRecordId, updateRunRecord } from './stores/runHistoryStore'

const { Option } = Select

const { Header, Content, Sider } = Layout
const GLOBAL_TOUR_SEEN_KEY = 'figforge.tour.global.v1'

function App() {
  const [selectedFunction, setSelectedFunction] = useState<RFunctionInfo | null>(null)
  const [running, setRunning] = useState(false)
  const [formResetTrigger, setFormResetTrigger] = useState(0)
  const [outputDir, setOutputDir] = useState<string | undefined>()
  const [allImages, setAllImages] = useState<string[]>([]) // 所有图片列表（包括上传的）
  const [activeTopTab, setActiveTopTab] = useState<'functions' | 'pipelines' | 'canvas'>('functions') // 顶层 tab
  const [exportModalVisible, setExportModalVisible] = useState(false)
  const [exportForm] = Form.useForm()
  const [exportProgress, setExportProgress] = useState<{ progress: number; message: string } | null>(null)
  
  // 保存相关状态
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const [saveForm] = Form.useForm()
  const [saveProgress, setSaveProgress] = useState<{ progress: number; message: string } | null>(null)

  // 分析完成右侧结果信息（成功或失败都弹出，不切换 tab）
  const [resultDrawerVisible, setResultDrawerVisible] = useState(false)
  const [resultDrawerInfo, setResultDrawerInfo] = useState<{
    outputDir?: string
    functionName?: string
    packageName?: string
    error?: string
  } | null>(null)
  const [resultDrawerFiles, setResultDrawerFiles] = useState<string[]>([])
  const [resultDrawerFilesLoading, setResultDrawerFilesLoading] = useState(false)
  const [globalTourOpen, setGlobalTourOpen] = useState(false)
  const [globalTourCurrent, setGlobalTourCurrent] = useState(0)
  const toolbarGuideRef = useRef<HTMLDivElement>(null)
  const functionListGuideRef = useRef<HTMLDivElement>(null)
  const functionDetailGuideRef = useRef<HTMLDivElement>(null)
  const canvasGuideRef = useRef<HTMLDivElement>(null)

  // 右侧结果抽屉打开时加载输出目录文件列表（仅成功且有 outputDir 时）
  useEffect(() => {
    if (!resultDrawerVisible || !resultDrawerInfo?.outputDir || resultDrawerInfo?.error) {
      setResultDrawerFiles([])
      return
    }
    let cancelled = false
    setResultDrawerFilesLoading(true)
    window.electronAPI
      .listFiles(resultDrawerInfo.outputDir, { extensions: ['png', 'jpg', 'jpeg', 'svg', 'pdf'] })
      .then((res) => {
        if (!cancelled && res.success && res.files) setResultDrawerFiles(res.files as string[])
      })
      .finally(() => {
        if (!cancelled) setResultDrawerFilesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [resultDrawerVisible, resultDrawerInfo?.outputDir])

  // 导出画布
  const handleExportCanvas = () => {
    setExportModalVisible(true)
    exportForm.setFieldsValue({
      format: 'png',
      dpi: 300,
    })
  }

  // 刷新或关闭页面前自动停止当前 R 分析
  useEffect(() => {
    const handleBeforeUnload = () => {
      if ('cancelCurrentRScript' in window.electronAPI && typeof window.electronAPI.cancelCurrentRScript === 'function') {
        window.electronAPI.cancelCurrentRScript()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // 监听导出进度
  useEffect(() => {
    const cleanup = window.electronAPI.onExportProgress?.((progress: number, message: string) => {
      setExportProgress({ progress, message })
    })
    return cleanup
  }, [])

  // 全局新手引导：首次自动弹出一次
  useEffect(() => {
    if (localStorage.getItem(GLOBAL_TOUR_SEEN_KEY) === '1') return
    const timer = window.setTimeout(() => {
      setGlobalTourCurrent(0)
      setGlobalTourOpen(true)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [])

  // 通知画布视图：已进入 canvas tab（用于触发画布内引导）
  useEffect(() => {
    if (activeTopTab === 'canvas') {
      window.dispatchEvent(new CustomEvent('canvas-view-activated'))
    }
  }, [activeTopTab])

  // 确认导出
  const handleConfirmExport = async () => {
    try {
      const values = await exportForm.validateFields()
      const { format, dpi } = values

      // 重置进度
      setExportProgress({ progress: 0, message: '准备导出...' })

      // 获取画布数据（包括图片的 data URL）
      // 使用 Promise 包装，添加超时和错误处理
      const canvasData = await new Promise<{ json?: unknown; imageDataUrl?: string; error?: string }>((resolve, reject) => {
        // 设置超时（5秒）
        const timeout = setTimeout(() => {
          window.removeEventListener('canvas-data', handler)
          reject(new Error('获取画布数据超时，请重试'))
        }, 5000)

        const handler = (e: Event) => {
          clearTimeout(timeout)
          const customEvent = e as CustomEvent
          const data = customEvent.detail || {}
          window.removeEventListener('canvas-data', handler)
          
          // 检查是否有错误
          if (data.error) {
            reject(new Error(data.error))
          } else {
            resolve(data)
          }
        }
        
        // 先添加监听器，再触发事件（确保不会错过事件）
        window.addEventListener('canvas-data', handler, { once: true })
        
        // 稍微延迟一下，确保监听器已经注册
        setTimeout(() => {
          // 触发导出事件
          const event = new CustomEvent('export-canvas')
          window.dispatchEvent(event)
        }, 10)
      })

      // 选择保存路径和文件名
      const extension = format === 'pdf' ? 'pdf' 
        : format === 'svg' ? 'svg' 
        : format === 'tiff' ? 'tiff' 
        : 'png'
      
      const formatName = format === 'pdf' ? 'PDF 文件' 
        : format === 'svg' ? 'SVG 文件' 
        : format === 'tiff' ? 'TIFF 图片' 
        : 'PNG 图片'
      
      const savePath = await window.electronAPI.selectSavePath({
        defaultPath: `canvas_export.${extension}`,
        filters: [
          { name: formatName, extensions: [extension] },
        ],
      })
      
      if (!savePath) {
        message.info('已取消导出')
        setExportProgress(null)
        return
      }

      const outputPath = savePath
      
      let exportResult
      if (format === 'pdf') {
        // 导出为 PDF
        // 使用画布的图片数据 URL，而不是 JSON 数据
        const imageDataUrl = (canvasData as { imageDataUrl?: string })?.imageDataUrl
        if (!imageDataUrl) {
          message.error('无法获取画布图片数据')
          setExportProgress(null)
          return
        }
        
        // 默认使用 A4 尺寸（8.27 x 11.69 英寸，转换为像素，假设 96 DPI）
        const defaultWidth = 794 // 8.27 * 96
        const defaultHeight = 1123 // 11.69 * 96
        exportResult = await window.electronAPI.exportToPDF({ imageDataUrl }, {
          outputPath,
          width: defaultWidth,
          height: defaultHeight,
          dpi: dpi || 300,
          template: 'custom',
        })
      } else if (format === 'svg') {
        // 导出为 SVG
        const svgString = (canvasData as { svgString?: string })?.svgString
        if (!svgString) {
          message.error('无法获取画布 SVG 数据')
          setExportProgress(null)
          return
        }
        
        setExportProgress({ progress: 50, message: '保存 SVG 文件...' })
        exportResult = await window.electronAPI.exportToSVG(svgString, outputPath)
      } else {
        // 导出为图片（PNG 或 TIFF）
        exportResult = await window.electronAPI.exportToImage(canvasData, {
          outputPath,
          format: format === 'tiff' ? 'tiff' : 'png',
          dpi: dpi || 300,
        })
      }

      if (exportResult && typeof exportResult === 'object' && 'success' in exportResult) {
        if ((exportResult as { success: boolean; error?: string }).success) {
          // 确保进度显示为 100%
          setExportProgress({ progress: 100, message: '导出完成！' })
          message.success('导出成功！')
          // 延迟关闭弹窗，让用户看到完成状态
          setTimeout(() => {
            setExportModalVisible(false)
            setExportProgress(null)
          }, 1000)
        } else {
          setExportProgress(null)
          message.error((exportResult as { error?: string }).error || '导出失败')
        }
      } else {
        setExportProgress(null)
        console.error('Export result format error:', exportResult)
        message.error('导出失败：返回格式错误')
      }
    } catch (error) {
      setExportProgress(null)
      console.error('Export error:', error)
      if (error && typeof error === 'object' && 'errorFields' in error) {
        // 表单验证错误
        return
      }
      const errorMsg = error instanceof Error ? error.message : String(error) || '未知错误'
      message.error(`导出失败: ${errorMsg}`)
    }
  }

  // 打开保存对话框
  const handleSaveImages = () => {
    if (allImages.length === 0) {
      message.warning('没有可保存的图片')
      return
    }
    setSaveModalVisible(true)
    saveForm.setFieldsValue({
      format: 'original', // 默认保持原格式
      dpi: 300,
    })
  }

  // 确认保存
  const handleConfirmSave = async () => {
    try {
      const values = await saveForm.validateFields()
      const { format, dpi } = values

      // 选择保存目录
      const saveDir = await window.electronAPI.selectDirectory()
      if (!saveDir) {
        message.info('已取消保存')
        return
      }

      setSaveProgress({ progress: 0, message: '准备保存...' })

      if (format === 'original') {
        // 保持原格式，直接复制
        setSaveProgress({ progress: 50, message: '复制文件...' })
        const copyResult = await window.electronAPI.copyFiles(allImages, saveDir)
        
        if (copyResult.success) {
          setSaveProgress({ progress: 100, message: '保存完成！' })
          setTimeout(() => {
            setSaveModalVisible(false)
            setSaveProgress(null)
            message.success(`已保存 ${allImages.length} 张图片`)
          }, 500)
        } else {
          setSaveProgress(null)
          message.error(copyResult.error || '保存失败')
        }
      } else {
        // 需要转换格式
        setSaveProgress({ progress: 10, message: `正在转换 ${allImages.length} 张图片...` })
        
        let successCount = 0
        let failCount = 0

        for (let i = 0; i < allImages.length; i++) {
          const imagePath = allImages[i]
          const progress = Math.round((i / allImages.length) * 80) + 10
          setSaveProgress({ 
            progress, 
            message: `正在转换第 ${i + 1}/${allImages.length} 张图片...` 
          })

          try {
            // 读取图片
            const readResult = await window.electronAPI.readImageAsDataUrl(imagePath)
            if (!readResult.success || !readResult.dataUrl) {
              failCount++
              continue
            }

            // 生成输出文件名
            const fileName = imagePath.split(/[/\\]/).pop() || 'image'
            const baseName = fileName.replace(/\.[^.]+$/, '')
            const extension = format === 'pdf' ? 'pdf' : format === 'svg' ? 'svg' : format === 'tiff' ? 'tiff' : 'png'
            const outputFileName = `${baseName}.${extension}`
            const outputPath = `${saveDir}/${outputFileName}`

            // 导出为指定格式
            if (format === 'pdf') {
              const defaultWidth = 794
              const defaultHeight = 1123
              await window.electronAPI.exportToPDF(
                { imageDataUrl: readResult.dataUrl },
                {
                  outputPath,
                  width: defaultWidth,
                  height: defaultHeight,
                  dpi: dpi || 300,
                  template: 'custom',
                }
              )
            } else if (format === 'svg') {
              // SVG 需要从 canvas 获取，这里暂时跳过或使用图片
              // 对于已存在的图片，无法转换为 SVG，跳过
              failCount++
              continue
            } else {
              // PNG 或 TIFF
              await window.electronAPI.exportToImage(
                { imageDataUrl: readResult.dataUrl },
                {
                  outputPath,
                  format: format === 'tiff' ? 'tiff' : 'png',
                  dpi: dpi || 300,
                }
              )
            }
            successCount++
          } catch (error) {
            console.error(`Failed to convert ${imagePath}:`, error)
            failCount++
          }
        }

        setSaveProgress({ progress: 100, message: '保存完成！' })
        setTimeout(() => {
          setSaveModalVisible(false)
          setSaveProgress(null)
          if (successCount > 0) {
            message.success(`已保存 ${successCount} 张图片${failCount > 0 ? `，${failCount} 张失败` : ''}`)
          } else {
            message.error('保存失败')
          }
        }, 500)
      }
    } catch (error) {
      setSaveProgress(null)
      console.error('Save error:', error)
      if (error && typeof error === 'object' && 'errorFields' in error) {
        // 表单验证错误
        return
      }
      message.error('保存时出错')
    }
  }

  // 运行函数（结果通过 run-r-script-result 事件回传，以便取消按钮能及时被主进程处理）
  const handleRunFunction = async (params: Record<string, unknown>, inputFiles: string[]) => {
    if (!selectedFunction) return

    setRunning(true)
    try {
      const gen = await window.electronAPI.generateRFunctionScript(
        selectedFunction.name,
        selectedFunction.package,
        params,
        inputFiles
      )
      if (!gen.success || !gen.outputDir || !gen.script) {
        message.error(gen.error || '生成 R 脚本失败')
        setRunning(false)
        return
      }

      // 运行记录中的 outputDir 用于「查看图片」：应为「图片实际所在目录」。
      // R 函数若收到 out_dir/outDir 参数，会把图写到该目录；未传时写到脚本 cwd（gen.outputDir）。
      const userOutDir = (params?.out_dir ?? params?.outDir) as string | undefined
      const imageOutputDir =
        typeof userOutDir === 'string' && userOutDir.trim() !== '' && userOutDir.trim() !== '.'
          ? userOutDir.trim()
          : gen.outputDir

      const startedAt = Date.now()
      const id = newRunRecordId(startedAt)
      addRunRecord({
        id,
        functionName: selectedFunction.name,
        packageName: selectedFunction.package,
        startedAt,
        status: 'running',
        outputDir: imageOutputDir,
        script: gen.script,
        params,
      })

      console.log('[FigForge:renderer] 注册 onRunRScriptResult 监听')
      const resultCleanup = window.electronAPI.onRunRScriptResult?.(result => {
        console.log('[FigForge:renderer] 收到 run-r-script-result', result)
        resultCleanup?.()
        if (result.success && result.outputDir) {
          updateRunRecord(id, { status: 'success', finishedAt: Date.now() })
          message.success('分析完成！')
          setOutputDir(result.outputDir)
          setFormResetTrigger(t => t + 1)
          setResultDrawerInfo({
            outputDir: result.outputDir,
            functionName: selectedFunction?.name,
            packageName: selectedFunction?.package,
          })
          setResultDrawerVisible(true)
        } else {
          const err = result.error || '脚本执行失败'
          updateRunRecord(id, { status: 'error', finishedAt: Date.now(), error: err })
          setResultDrawerInfo({
            functionName: selectedFunction?.name,
            packageName: selectedFunction?.package,
            error: err,
          })
          setResultDrawerVisible(true)
          if (err !== '分析已取消') message.error(err)
          else message.info('分析已取消')
        }
        setRunning(false)
      })

      console.log('[FigForge:renderer] 调用 runRScript')
      const run = await window.electronAPI.runRScript(gen.outputDir, gen.script)
      console.log('[FigForge:renderer] runRScript 返回', run)
      if (!run.started) {
        resultCleanup?.()
        setRunning(false)
        if (!run.success) {
          updateRunRecord(id, { status: 'error', finishedAt: Date.now(), error: run.error })
          message.error(run.error || '启动失败')
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      if (errMsg === '分析已取消') {
        message.info('分析已取消')
      } else {
        message.error('运行函数时出错')
        console.error(error)
      }
      setRunning(false)
    }
  }

  const handleEditImageInCanvas = useCallback((imagePath: string, source: { outputDir: string; functionName?: string; packageName?: string; rdsFile?: string; sourceParams?: Record<string, unknown> }) => {
    setActiveTopTab('canvas')
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('add-image-to-canvas', {
          detail: { imagePath, outputDir: source.outputDir, functionName: source.functionName, packageName: source.packageName, rdsFile: source.rdsFile, sourceParams: source.sourceParams },
        })
      )
    }, 150)
  }, [])

  const topTabsItems = [
    {
      key: 'functions',
      label: (
        <span>
          <FunctionOutlined />
          函数视图
        </span>
      ),
      children: (
        <Layout style={{ height: '100%', minHeight: 0 }}>
          <Sider width={300}>
            <div ref={functionListGuideRef} style={{ height: '100%' }}>
              <FunctionList onSelectFunction={setSelectedFunction} />
            </div>
          </Sider>
          <Content style={{ display: 'flex', minHeight: 0 }}>
            <div ref={functionDetailGuideRef} style={{ width: '100%', minHeight: 0 }}>
              <FunctionDetail
                functionInfo={selectedFunction}
                onRun={handleRunFunction}
                loading={running}
                formResetTrigger={formResetTrigger}
              />
            </div>
          </Content>
        </Layout>
      ),
    },
    {
      key: 'pipelines',
      label: (
        <span>
          <FunctionOutlined />
          Pipeline 流程
        </span>
      ),
      children: <PipelineView />,
    },
    {
      key: 'canvas',
      label: (
        <span>
          <EditOutlined />
          画布视图
        </span>
      ),
      children: (
        <div ref={canvasGuideRef} style={{ height: '100%' }}>
          <ResultView
            outputDir={outputDir}
            sourceFunctionName={resultDrawerInfo?.functionName}
            sourcePackageName={resultDrawerInfo?.packageName}
            onImagesChange={setAllImages}
          />
        </div>
      ),
    },
  ]

  const globalTourSteps = [
    {
      title: '顶部工具栏',
      description: '这里可以运行分析、导出画布、保存素材，是全局主操作入口。',
      target: () => toolbarGuideRef.current ?? document.body,
    },
    {
      title: '函数选择区',
      description: '先在左侧选择一个分析函数。',
      target: () => functionListGuideRef.current ?? document.body,
    },
    {
      title: '参数与运行区',
      description: '在这里填写参数并运行分析；运行成功后会产出图片。',
      target: () => functionDetailGuideRef.current ?? document.body,
    },
    {
      title: '切换到画布视图',
      description: '分析结果会在画布视图里做素材管理与可视化编辑。',
      target: () => canvasGuideRef.current ?? document.body,
    },
  ]

  return (
    <div className={styles.app}>
      <Layout>
        <Header>
          <div ref={toolbarGuideRef}>
            <Toolbar 
              activeTab={activeTopTab}
              running={running}
              onRunAnalysis={() => {
                // 触发函数详情页面的运行按钮
                const event = new CustomEvent('trigger-run-analysis')
                window.dispatchEvent(event)
              }}
              onExport={handleExportCanvas}
              onSave={handleSaveImages}
              onEditImageInCanvas={handleEditImageInCanvas}
            />
          </div>
        </Header>
        <Content style={{ height: 'calc(100vh - 64px)' }}>
          <Tabs
            activeKey={activeTopTab}
            onChange={(key) => {
              setActiveTopTab(key as 'functions' | 'pipelines' | 'canvas')
              // 切换到画布视图时，如果有 outputDir 就显示，否则提示
              if (key === 'canvas' && !outputDir) {
                message.info('请先运行分析生成图片')
                // 可以选择自动切换回函数视图，或者保持当前状态
              }
            }}
            items={topTabsItems}
            style={{ height: '100%' }}
            type="card"
            tabBarExtraContent={{
              right: (
                <Button
                  type="text"
                  size="small"
                  icon={<QuestionCircleOutlined />}
                  onClick={() => {
                    setActiveTopTab('functions')
                    setGlobalTourCurrent(0)
                    setGlobalTourOpen(true)
                  }}
                >
                  新手引导
                </Button>
              ),
            }}
          />
        </Content>
      </Layout>
      <Tour
        open={globalTourOpen}
        onClose={() => {
          setGlobalTourOpen(false)
          localStorage.setItem(GLOBAL_TOUR_SEEN_KEY, '1')
        }}
        current={globalTourCurrent}
        onChange={(next) => {
          setGlobalTourCurrent(next)
          if (next >= 3) {
            setActiveTopTab('canvas')
          } else {
            setActiveTopTab('functions')
          }
        }}
        steps={globalTourSteps}
      />
      
      {/* 导出格式选择对话框 */}
      <Modal
        title="选择导出格式"
        open={exportModalVisible}
        onOk={handleConfirmExport}
        onCancel={() => {
          // 如果正在导出，不允许关闭
          if (exportProgress !== null && exportProgress.progress < 100) {
            return
          }
          setExportModalVisible(false)
          setExportProgress(null)
        }}
        okText="导出"
        cancelText="取消"
        okButtonProps={{ 
          disabled: exportProgress !== null && exportProgress.progress < 100,
          loading: exportProgress !== null && exportProgress.progress < 100
        }}
        cancelButtonProps={{
          disabled: exportProgress !== null && exportProgress.progress < 100
        }}
        maskClosable={exportProgress === null || exportProgress.progress === 100}
        keyboard={exportProgress === null || exportProgress.progress === 100}
        closable={exportProgress === null || exportProgress.progress === 100}
      >
        <Form form={exportForm} layout="vertical">
          <Form.Item
            name="format"
            label="导出格式"
            rules={[{ required: true, message: '请选择导出格式' }]}
          >
            <Select placeholder="请选择导出格式" disabled={exportProgress !== null}>
              <Option value="png">PNG 图片</Option>
              <Option value="tiff">TIFF 图片</Option>
              <Option value="pdf">PDF 文档</Option>
              <Option value="svg">SVG 矢量图</Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="dpi"
            label="分辨率 (DPI)"
            rules={[{ required: true, message: '请输入分辨率' }]}
            initialValue={300}
          >
            <InputNumber
              min={72}
              max={600}
              step={50}
              placeholder="300"
              style={{ width: '100%' }}
              disabled={exportProgress !== null}
            />
          </Form.Item>
        </Form>
        
        {exportProgress && (
          <div style={{ marginTop: 16 }}>
            <Progress 
              percent={exportProgress.progress} 
              status={exportProgress.progress === 100 ? 'success' : 'active'}
              format={(percent) => `${percent}%`}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
              {exportProgress.message}
            </div>
          </div>
        )}
      </Modal>

      {/* 保存格式选择对话框 */}
      <Modal
        title="选择保存格式"
        open={saveModalVisible}
        onOk={handleConfirmSave}
        onCancel={() => {
          // 如果正在保存，不允许关闭
          if (saveProgress !== null && saveProgress.progress < 100) {
            return
          }
          setSaveModalVisible(false)
          setSaveProgress(null)
        }}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ 
          disabled: saveProgress !== null && saveProgress.progress < 100,
          loading: saveProgress !== null && saveProgress.progress < 100
        }}
        cancelButtonProps={{
          disabled: saveProgress !== null && saveProgress.progress < 100
        }}
        maskClosable={saveProgress === null || saveProgress.progress === 100}
        keyboard={saveProgress === null || saveProgress.progress === 100}
        closable={saveProgress === null || saveProgress.progress === 100}
      >
        <Form form={saveForm} layout="vertical">
          <Form.Item
            name="format"
            label="保存格式"
            rules={[{ required: true, message: '请选择保存格式' }]}
          >
            <Select placeholder="请选择保存格式" disabled={saveProgress !== null}>
              <Option value="original">保持原格式</Option>
              <Option value="png">PNG 图片</Option>
              <Option value="tiff">TIFF 图片</Option>
              <Option value="pdf">PDF 文档</Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="dpi"
            label="分辨率 (DPI)"
            rules={[{ required: true, message: '请输入分辨率' }]}
            initialValue={300}
            tooltip="仅在转换格式时生效"
          >
            <InputNumber
              min={72}
              max={600}
              step={50}
              placeholder="300"
              style={{ width: '100%' }}
              disabled={saveProgress !== null}
            />
          </Form.Item>
        </Form>
        
        {saveProgress && (
          <div style={{ marginTop: 16 }}>
            <Progress 
              percent={saveProgress.progress} 
              status={saveProgress.progress === 100 ? 'success' : 'active'}
              format={(percent) => `${percent}%`}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
              {saveProgress.message}
            </div>
          </div>
        )}
      </Modal>

      {/* 分析结果：右侧抽屉（成功或失败都弹出，不切换 tab） */}
      <Drawer
        title={resultDrawerInfo?.error ? '分析结束' : '分析完成'}
        placement="right"
        open={resultDrawerVisible}
        onClose={() => {
          setResultDrawerVisible(false)
          setResultDrawerInfo(null)
        }}
        width={360}
        destroyOnClose
      >
        {resultDrawerInfo && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {resultDrawerInfo.functionName && (
              <div>
                <Typography.Text type="secondary">函数</Typography.Text>
                <div><Typography.Text strong>{resultDrawerInfo.functionName}</Typography.Text></div>
                {resultDrawerInfo.packageName && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{resultDrawerInfo.packageName}</Typography.Text>
                )}
              </div>
            )}
            {resultDrawerInfo.error ? (
              <div>
                <Typography.Text type="danger">错误信息</Typography.Text>
                <div style={{ marginTop: 8, padding: 12, background: '#fff2f0', borderRadius: 8, fontSize: 12, wordBreak: 'break-word' }}>
                  {resultDrawerInfo.error}
                </div>
              </div>
            ) : (
              <>
                {resultDrawerInfo.outputDir && (
                  <div>
                    <Typography.Text type="secondary">输出目录</Typography.Text>
                    <div style={{ wordBreak: 'break-all', fontSize: 12, marginTop: 4 }}>
                      {resultDrawerInfo.outputDir}
                    </div>
                  </div>
                )}
                <div>
                  <Typography.Text type="secondary">生成文件</Typography.Text>
                  {resultDrawerFilesLoading ? (
                    <div style={{ marginTop: 8 }}><Spin size="small" /> 加载中…</div>
                  ) : resultDrawerFiles.length === 0 ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>暂无图片/PDF 文件</div>
                  ) : (
                    <List
                      size="small"
                      style={{ marginTop: 8 }}
                      dataSource={resultDrawerFiles}
                      renderItem={(path) => (
                        <List.Item style={{ padding: '4px 0' }}>
                          <Typography.Text ellipsis style={{ fontSize: 12 }}>
                            {path.split(/[/\\]/).pop()}
                          </Typography.Text>
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Drawer>

    </div>
  )
}

export default App

