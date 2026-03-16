import { useState, useEffect, useRef, useMemo } from 'react'
import { Image, Empty, Button, message, Radio, Tag, Space, Segmented, InputNumber, Tooltip } from 'antd'
import { PictureOutlined, UploadOutlined, DeleteOutlined, FilePdfOutlined, DownOutlined, RightOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import LayoutEditor from '../LayoutEditor'
import { listRunHistory, subscribeRunHistory, type RunRecord } from '../../stores/runHistoryStore'
import { pdfFirstPageToDataUrl } from '../../utils/pdfToDataUrl'
import styles from './index.module.less'

// 判断文件是否为图片
const isImageFile = (path: string): boolean => {
  const ext = path.split('.').pop()?.toLowerCase()
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(ext || '')
}

// 判断文件是否为 PDF
const isPdfFile = (path: string): boolean => {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext === 'pdf'
}

interface ResultViewProps {
  outputDir?: string
  /** 当前结果对应的 R 函数名（用于重绘时指明用哪个重绘函数） */
  sourceFunctionName?: string
  /** 当前结果对应的 R 包名 */
  sourcePackageName?: string
  onImageGenerated?: (imagePath: string) => void
  onImagesChange?: (images: string[]) => void
}

function ResultView({ outputDir, sourceFunctionName, sourcePackageName, onImagesChange }: ResultViewProps) {
  const [currentRunImages, setCurrentRunImages] = useState<string[]>([])
  const [uploadedImages, setUploadedImages] = useState<Array<{ path: string; batchId: string; uploadedAt: number }>>([]) // 用户上传的图片
  const [imageDataUrls, setImageDataUrls] = useState<Record<string, string>>({}) // 图片的 data URL 缓存
  const [materialTab, setMaterialTab] = useState<'analysis' | 'upload'>('analysis')
  const [analysisRunLimit, setAnalysisRunLimit] = useState<number>(20)
  const [collapsedMethods, setCollapsedMethods] = useState<Record<string, boolean>>({})
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [historyRecords, setHistoryRecords] = useState<RunRecord[]>([])
  const [historyImagesByRunId, setHistoryImagesByRunId] = useState<Record<string, string[]>>({})
  const [addBusy, setAddBusy] = useState(false)
  const [addBusyFileName, setAddBusyFileName] = useState<string>('')
  const canvasRef = useRef<HTMLDivElement>(null)
  const lastAddClickAtRef = useRef<Record<string, number>>({})

  // 扫描当前输出目录中的图片（当前运行兜底）
  useEffect(() => {
    if (!outputDir) {
      setCurrentRunImages([])
      return
    }

    const scanImages = async () => {
      try {
        const result = await (window.electronAPI as any).listFiles(outputDir, {
          extensions: ['png', 'jpg', 'jpeg', 'svg', 'pdf'],
        })
        if (result.success && result.files) {
          setCurrentRunImages(result.files as string[])
        }
      } catch (error) {
        console.error('Failed to scan images:', error)
      }
    }

    scanImages()
  }, [outputDir])

  // 订阅运行记录（用于分析结果分组）
  useEffect(() => {
    const refresh = () => {
      const limit = Math.max(1, Math.min(200, Math.floor(analysisRunLimit || 20)))
      const records = listRunHistory().filter((r) => r.status === 'success' && !!r.outputDir).slice(0, limit)
      setHistoryRecords(records)
    }
    refresh()
    return subscribeRunHistory(refresh)
  }, [analysisRunLimit])

  // 读取运行记录对应目录的图片
  useEffect(() => {
    let cancelled = false
    const missing = historyRecords.filter((r) => historyImagesByRunId[r.id] === undefined)
    if (missing.length === 0) return

    const run = async () => {
      const entries = await Promise.all(missing.map(async (r) => {
        try {
          const res = await (window.electronAPI as any).listFiles(r.outputDir, {
            extensions: ['png', 'jpg', 'jpeg', 'svg', 'pdf'],
          })
          const files = res?.success && Array.isArray(res.files) ? (res.files as string[]) : []
          return [r.id, files] as const
        } catch {
          return [r.id, []] as const
        }
      }))
      if (cancelled) return
      setHistoryImagesByRunId((prev) => {
        const next = { ...prev }
        for (const [id, files] of entries) next[id] = files
        return next
      })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [historyRecords, historyImagesByRunId])

  const analysisGroups = useMemo(() => {
    const runItems = historyRecords.map((r) => ({
      runId: r.id,
      method: r.functionName || '未命名方法',
      packageName: r.packageName,
      outputDir: r.outputDir,
      label: `${new Date(r.startedAt).toLocaleString()} · ${r.outputDir.split(/[/\\]/).pop() || r.outputDir}`,
      items: historyImagesByRunId[r.id] || [],
    }))

    // 当前运行若不在历史记录中，作为兜底显示
    if (outputDir && currentRunImages.length > 0 && !runItems.some((r) => r.outputDir === outputDir)) {
      runItems.unshift({
        runId: `current::${outputDir}`,
        method: sourceFunctionName || '当前运行',
        packageName: sourcePackageName,
        outputDir,
        label: `当前运行 · ${outputDir.split(/[/\\]/).pop() || outputDir}`,
        items: currentRunImages,
      })
    }

    // 仅保留有图片的运行
    const nonEmptyRuns = runItems.filter((r) => r.items.length > 0)
    const methodMap = new Map<string, typeof runItems>()
    for (const run of nonEmptyRuns) {
      const key = run.method || '未命名方法'
      const list = methodMap.get(key) || []
      list.push(run)
      methodMap.set(key, list)
    }
    return Array.from(methodMap.entries())
      .map(([method, runs]) => ({ method, runs }))
      .filter((g) => g.runs.length > 0)
  }, [historyRecords, historyImagesByRunId, outputDir, currentRunImages, sourceFunctionName, sourcePackageName])

  useEffect(() => {
    if (analysisGroups.length === 0) return
    setCollapsedMethods((prev) => {
      const next: Record<string, boolean> = {}
      analysisGroups.forEach((g, index) => {
        next[g.method] = prev[g.method] ?? index !== 0
      })
      return next
    })
  }, [analysisGroups])

  // 合并分析生成的图片和用户上传的图片（仅用于通知父组件）
  const allImages = useMemo(() => {
    const analysisPaths = analysisGroups.flatMap((g) => g.runs.flatMap((r) => r.items))
    return [...new Set([...analysisPaths, ...uploadedImages.map((u) => u.path)])]
  }, [analysisGroups, uploadedImages])
  
  // 通知父组件图片列表变化
  useEffect(() => {
    if (onImagesChange) {
      onImagesChange(allImages)
    }
  }, [allImages, onImagesChange])

  // 加载图片的 data URL
  useEffect(() => {
    const loadImageDataUrls = async () => {
      const newDataUrls: Record<string, string> = {}
      
      for (const path of allImages) {
        if (imageDataUrls[path]) continue
        if (isPdfFile(path)) {
          try {
            const readRes = await window.electronAPI.readFile(path)
            if (!readRes.success || !readRes.content || !/^data:application\/pdf;base64,/i.test(readRes.content)) continue
            const base64 = readRes.content.replace(/^data:application\/pdf;base64,/i, '')
            const binary = atob(base64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
            const { dataUrl } = await pdfFirstPageToDataUrl(bytes.buffer, 1.2)
            newDataUrls[path] = dataUrl
          } catch (error) {
            console.error(`Failed to load pdf preview ${path}:`, error)
          }
          continue
        }

        // 非 PDF 文件统一尝试预览，覆盖常见格式（png/jpg/svg/webp/gif/bmp 等）
        try {
          const result = await window.electronAPI.readImageAsDataUrl(path)
          if (result.success && result.dataUrl) {
            newDataUrls[path] = result.dataUrl
          }
        } catch (error) {
          if (isImageFile(path)) {
            console.error(`Failed to load image ${path}:`, error)
          }
        }
      }
      
      if (Object.keys(newDataUrls).length > 0) {
        setImageDataUrls((prev) => ({ ...prev, ...newDataUrls }))
      }
    }

    loadImageDataUrls()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allImages])

  // 监听画布侧添加队列状态：添加完成前，左侧“添加”入口统一锁定
  useEffect(() => {
    const onQueueStatus = (evt: Event) => {
      const e = evt as CustomEvent<{ busy?: boolean; currentImagePath?: string | null }>
      setAddBusy(Boolean(e.detail?.busy))
      const p = e.detail?.currentImagePath
      const name = typeof p === 'string' && p
        ? (p.split(/[/\\]/).pop() || p)
        : ''
      setAddBusyFileName(name)
    }
    window.addEventListener('add-image-queue-status', onQueueStatus as EventListener)
    return () => window.removeEventListener('add-image-queue-status', onQueueStatus as EventListener)
  }, [])

  // 上传图片
  const handleUploadImages = async () => {
    try {
      const files = await window.electronAPI.selectFiles({
        filters: [
          { name: '图片和PDF文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'pdf'] },
          { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'] },
          { name: 'PDF 文件', extensions: ['pdf'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile', 'multiSelections'],
      } as any)

      if (files && files.length > 0) {
        const now = Date.now()
        const batchId = `${new Date(now).toLocaleString()}`
        const uploaded = files.map((p) => ({ path: p, batchId, uploadedAt: now }))
        setUploadedImages((prev) => [...prev, ...uploaded])
        message.success(`已添加 ${files.length} 张图片`)
      }
    } catch (error) {
      console.error('Failed to upload images:', error)
      message.error('上传图片时出错')
    }
  }

  // 删除图片
  const handleDeleteImage = (path: string) => {
    setUploadedImages((prev) => prev.filter((x) => x.path !== path))
  }

  // 处理拖拽开始
  const handleDragStart = (e: React.DragEvent, imagePath: string) => {
    e.dataTransfer.setData('imagePath', imagePath)
    e.dataTransfer.effectAllowed = 'copy'
  }

  // 处理画布区域的拖拽
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const emitAddImageToCanvas = (imagePath: string) => {
    if (addBusy) return
    const now = Date.now()
    const last = lastAddClickAtRef.current[imagePath] || 0
    if (now - last < 300) return
    lastAddClickAtRef.current[imagePath] = now
    // 兜底来源：用于上传素材或无法匹配运行记录时
    const event = new CustomEvent('add-image-to-canvas', {
      detail: {
        imagePath,
        outputDir,
        functionName: sourceFunctionName,
        packageName: sourcePackageName,
      },
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)
  }

  const emitAddAnalysisImageToCanvas = (
    imagePath: string,
    source: { outputDir: string; functionName?: string; packageName?: string },
  ) => {
    if (addBusy) return
    const key = `${imagePath}::${source.outputDir}`
    const now = Date.now()
    const last = lastAddClickAtRef.current[key] || 0
    if (now - last < 300) return
    lastAddClickAtRef.current[key] = now
    const event = new CustomEvent('add-image-to-canvas', {
      detail: {
        imagePath,
        outputDir: source.outputDir,
        functionName: source.functionName,
        packageName: source.packageName,
      },
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const imagePath = e.dataTransfer.getData('imagePath')
    if (imagePath) {
      emitAddImageToCanvas(imagePath)
    } else {
      console.warn('拖拽放下，但没有获取到 imagePath')
    }
  }

  const uploadGroups = useMemo(() => {
    const m = new Map<string, Array<{ path: string; batchId: string; uploadedAt: number }>>()
    for (const item of uploadedImages) {
      const arr = m.get(item.batchId) || []
      arr.push(item)
      m.set(item.batchId, arr)
    }
    return Array.from(m.entries()).map(([batchId, items]) => ({ batchId, items }))
  }, [uploadedImages])

  const toggleMethod = (method: string) => {
    setCollapsedMethods((prev) => ({ ...prev, [method]: !prev[method] }))
  }

  const collapsedBadgeCount = materialTab === 'analysis'
    ? analysisGroups.reduce((sum, g) => sum + g.runs.reduce((s, r) => s + r.items.length, 0), 0)
    : uploadedImages.length

  return (
    <div className={styles.resultView}>
      <div className={`${styles.leftPanel} ${leftPanelCollapsed ? styles.leftPanelCollapsed : ''}`}>
        {leftPanelCollapsed ? (
          <div className={styles.collapsedDock}>
            <Tooltip placement="right" title="展开素材区">
              <Button
                type="text"
                shape="circle"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setLeftPanelCollapsed(false)}
              />
            </Tooltip>
            {collapsedBadgeCount > 0 && (
              <div className={styles.collapsedCount}>
                {collapsedBadgeCount > 99 ? '99+' : collapsedBadgeCount}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className={styles.panelHeader}>
              <div className={styles.headerTitle}>
                <PictureOutlined />
                <span>图片列表</span>
              </div>
              <Space size={6}>
                {materialTab === 'upload' && (
                  <Button
                    type="primary"
                    size="small"
                    icon={<UploadOutlined />}
                    onClick={handleUploadImages}
                  >
                    上传
                  </Button>
                )}
                <Button
                  type="text"
                  size="small"
                  icon={<MenuFoldOutlined />}
                  onClick={() => setLeftPanelCollapsed(true)}
                  title="收起素材区"
                />
              </Space>
            </div>
            <div className={styles.panelTabs}>
          <Radio.Group
            size="small"
            value={materialTab}
            onChange={(e) => setMaterialTab(e.target.value)}
            options={[
              { label: '分析结果', value: 'analysis' },
              { label: '上传素材', value: 'upload' },
            ]}
          />
          {materialTab === 'analysis' && (
            <div className={styles.analysisToolbar}>
              <span className={styles.toolbarLabel}>最近运行</span>
              <Segmented
                size="small"
                value={analysisRunLimit}
                options={[
                  { label: '10', value: 10 },
                  { label: '20', value: 20 },
                  { label: '40', value: 40 },
                ]}
                onChange={(v) => setAnalysisRunLimit(Number(v))}
              />
              <InputNumber
                size="small"
                min={1}
                max={200}
                step={1}
                precision={0}
                value={analysisRunLimit}
                onChange={(v) => {
                  if (typeof v !== 'number' || Number.isNaN(v)) return
                  const next = Math.max(1, Math.min(200, Math.floor(v)))
                  setAnalysisRunLimit(next)
                }}
                style={{ width: 66 }}
              />
            </div>
          )}
            </div>
            <div className={styles.imageList}>
          {materialTab === 'analysis' && analysisGroups.length === 0 ? (
            <div className={styles.empty}>
              <Empty
                image={<PictureOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />}
                description={
                  <div>
                    <p>暂无图片</p>
                    <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                      运行成功后的图片会在这里按方法和运行实例分组展示
                    </p>
                  </div>
                }
              />
            </div>
          ) : materialTab === 'upload' && uploadGroups.length === 0 ? (
            <div className={styles.empty}>
              <Empty description="暂无上传素材，点击右上角上传" />
            </div>
          ) : (
            <div className={styles.groupList}>
              {materialTab === 'analysis' && analysisGroups.map((methodGroup) => (
                <div key={methodGroup.method} className={styles.groupBlock}>
                  <div className={styles.groupHeader} onClick={() => toggleMethod(methodGroup.method)}>
                    <span className={styles.groupHeaderLeft}>
                      {collapsedMethods[methodGroup.method] ? <RightOutlined /> : <DownOutlined />}
                      <span className={styles.groupMethodName} title={methodGroup.method}>{methodGroup.method}</span>
                    </span>
                    <Space size={6}>
                      <Tag>{methodGroup.runs.length} 次</Tag>
                    </Space>
                  </div>
                  {!collapsedMethods[methodGroup.method] && methodGroup.runs.map((run) => (
                    <div key={run.runId} className={styles.runBlock}>
                      <div className={styles.runHeader}>{run.label}（{run.items.length}）</div>
                      {run.items.map((path) => {
                        const isPdf = isPdfFile(path)
                        const isImage = isImageFile(path)
                        return (
                          <div key={path} className={styles.imageRow} draggable onDragStart={(e) => handleDragStart(e, path)}>
                            <div className={styles.thumb}>
                              {imageDataUrls[path] ? (
                                <Image src={imageDataUrls[path]} preview={{ mask: '预览' }} />
                              ) : isPdf ? <FilePdfOutlined style={{ color: '#ff4d4f' }} /> : (isImage ? <PictureOutlined /> : <PictureOutlined />)}
                            </div>
                            <div className={styles.rowMeta}>
                              <div className={styles.imageName}>{path.split(/[/\\]/).pop()}</div>
                            </div>
                            <Button size="small" disabled={addBusy} onClick={() => emitAddAnalysisImageToCanvas(path, {
                              outputDir: run.outputDir,
                              functionName: run.method,
                              packageName: run.packageName,
                            })}>添加</Button>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              ))}
              {materialTab === 'upload' && uploadGroups.map((group) => (
                <div key={group.batchId} className={styles.groupBlock}>
                  <div className={styles.groupHeader}>
                    <span>{group.batchId}</span>
                    <Tag>上传批次</Tag>
                  </div>
                  {group.items.map((item) => {
                    const path = item.path
                    const isPdf = isPdfFile(path)
                    const isImage = isImageFile(path)
                    return (
                      <div key={path} className={styles.imageRow} draggable onDragStart={(e) => handleDragStart(e, path)}>
                        <div className={styles.thumb}>
                          {imageDataUrls[path] ? (
                            <Image src={imageDataUrls[path]} preview={{ mask: '预览' }} />
                          ) : isPdf ? <FilePdfOutlined style={{ color: '#ff4d4f' }} /> : (isImage ? <PictureOutlined /> : <PictureOutlined />)}
                        </div>
                        <div className={styles.rowMeta}>
                          <div className={styles.imageName}>{path.split(/[/\\]/).pop()}</div>
                        </div>
                        <Space size={4}>
                          <Button size="small" disabled={addBusy} onClick={() => emitAddImageToCanvas(path)}>添加</Button>
                          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteImage(path)} />
                        </Space>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
          {addBusy && (
            <div className={styles.addBusyMask}>
              <div className={styles.addBusyText}>
                {addBusyFileName ? `正在添加：${addBusyFileName}` : '正在添加图片，请等待完成…'}
              </div>
            </div>
          )}
            </div>
          </>
        )}
      </div>
      <div
        ref={canvasRef}
        className={styles.rightPanel}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <LayoutEditor />
      </div>
    </div>
  )
}

export default ResultView
