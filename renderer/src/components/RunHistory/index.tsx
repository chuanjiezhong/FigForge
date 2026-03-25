import { useEffect, useMemo, useState, useCallback } from 'react'
import { Modal, Table, Button, Space, Drawer, Tag, message, Input, Image, Empty, Form, InputNumber, Select, Switch, Divider, Tabs, Spin } from 'antd'
import { HistoryOutlined, DeleteOutlined, FilePdfOutlined, EditOutlined } from '@ant-design/icons'
import styles from './index.module.less'
import {
  clearRunHistory,
  deleteRunRecord,
  listRunHistory,
  subscribeRunHistory,
  updateRunRecord,
  type RunRecord,
  type RunStatus,
} from '../../stores/runHistoryStore'
import type { ColumnsType } from 'antd/es/table'
import { pdfFirstPageToDataUrl } from '../../utils/pdfToDataUrl'
import InterpretationDocModal from '../InterpretationDocModal'

const { TextArea } = Input
const { Option } = Select

function defaultInterpretationPaths(outputDir: string) {
  const p = outputDir.replace(/[/\\]$/, '').replace(/\\/g, '/')
  return {
    zh: `${p}/_pipeline/interpretation_zh.md`,
    en: `${p}/_pipeline/interpretation_en.md`,
    meta: `${p}/_pipeline/interpretation_meta.json`,
  }
}

type PlotParamDef = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'array' | 'color'
  description?: string
  required?: boolean
  default?: unknown
  options?: string[]
  placeholder?: string
  min?: number
  max?: number
}

type PlotConfig = {
  plotFunction: string
  rdsFile: string
  rdsParamName?: string
  outDirParamName?: string
  packageName?: string
  parameters?: PlotParamDef[]
  scriptTemplate?: string
}

type RunHistoryProps = {
  open: boolean
  onClose: () => void
  /** 从运行记录某张图点击「编辑」：跳转画布并把该图加到画布（含 rdsFile、sourceParams 供重绘与旧参数对比） */
  onEditImageInCanvas?: (imagePath: string, source: { outputDir: string; functionName?: string; packageName?: string; rdsFile?: string; sourceParams?: Record<string, unknown> }) => void
}

export default function RunHistory({ open, onClose, onEditImageInCanvas }: RunHistoryProps) {
  const [loading, setLoading] = useState(false)
  const [records, setRecords] = useState<RunRecord[]>([])
  const [selected, setSelected] = useState<RunRecord | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [imagesOpen, setImagesOpen] = useState(false)
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [imageDataUrls, setImageDataUrls] = useState<Record<string, string>>({})
  const [pdfDataUrls, setPdfDataUrls] = useState<Record<string, string>>({})
  const [docsMap, setDocsMap] = useState<Record<string, PlotConfig>>({})
  const [plotForm] = Form.useForm()
  const [plotting, setPlotting] = useState(false)
  /** 运行记录详情：解读稿文件内容与用户备注 */
  const [interpLoading, setInterpLoading] = useState(false)
  const [interpFileZh, setInterpFileZh] = useState('')
  const [interpFileEn, setInterpFileEn] = useState('')
  const [interpNoteZh, setInterpNoteZh] = useState('')
  const [interpNoteEn, setInterpNoteEn] = useState('')
  const [interpretModalOpen, setInterpretModalOpen] = useState(false)

  const isImageFile = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase()
    return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(ext || '')
  }
  const isPdfFile = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase()
    return ext === 'pdf'
  }

  const refresh = () => {
    setLoading(true)
    try {
      setRecords(listRunHistory().slice(0, 200))
    } finally {
      setLoading(false)
    }
  }

  const getPlotConfig = useCallback((record: RunRecord | null): PlotConfig | undefined => {
    if (!record) return
    const key = `${record.packageName || ''}::${record.functionName}`
    return docsMap[key]
  }, [docsMap])

  useEffect(() => {
    if (!open) return
    refresh()
    const unsub = subscribeRunHistory(() => refresh())
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const loadDocs = async () => {
      try {
        const res = await window.electronAPI.getAllFunctionDocs()
        if (res.success && res.docs) {
          const map: Record<string, PlotConfig> = {}
          const docs = Array.isArray(res.docs) ? res.docs : []
          for (const raw of docs) {
            if (!raw || typeof raw !== 'object') continue
            const d = raw as { name?: string; package?: string; plotConfig?: PlotConfig }
            if (d.name && d.plotConfig) {
              const key = `${d.package || ''}::${d.name}`
              map[key] = d.plotConfig
            }
          }
          setDocsMap(map)
        }
      } catch {
        // ignore
      }
    }
    loadDocs()
  }, [open])

  // 详情抽屉打开时加载输出目录下的图片列表
  useEffect(() => {
    if ((!detailOpen && !imagesOpen) || !selected?.outputDir) return
    const loadImages = async () => {
      try {
        const res = await window.electronAPI.listFiles(selected.outputDir, {
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'pdf'],
          recursive: true,
        })
        if (res.success && res.files) {
          setImagePaths(res.files as string[])
        } else {
          setImagePaths([])
          if (imagesOpen) message.error(res.error || '加载图片失败')
        }
      } catch (e) {
        setImagePaths([])
        if (imagesOpen) message.error('加载图片失败')
      }
    }
    loadImages()
  }, [detailOpen, imagesOpen, selected])

  useEffect(() => {
    let cancelled = false
    const loadDataUrls = async () => {
      // 1) 普通图片：并行加载，优先显示，避免被 PDF 转换阻塞
      const imgTargets = imagePaths.filter((p) => isImageFile(p) && !imageDataUrls[p])
      if (imgTargets.length > 0) {
        const results = await Promise.allSettled(
          imgTargets.map(async (p) => {
            const res = await window.electronAPI.readImageAsDataUrl(p)
            return res.success && res.dataUrl ? ({ path: p, dataUrl: res.dataUrl }) : null
          })
        )
        if (!cancelled) {
          const next: Record<string, string> = {}
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) next[r.value.path] = r.value.dataUrl
          }
          if (Object.keys(next).length > 0) setImageDataUrls((prev) => ({ ...prev, ...next }))
        }
      }

      // 2) PDF：逐个异步转换第一页为 PNG 预览，不阻塞 PNG
      const pdfTargets = imagePaths.filter((p) => isPdfFile(p) && !pdfDataUrls[p])
      for (const p of pdfTargets) {
        ;(async () => {
          try {
            const readRes = await window.electronAPI.readFile(p)
            if (!readRes.success || !readRes.content || !/^data:application\/pdf;base64,/i.test(readRes.content)) return
            const base64 = readRes.content.replace(/^data:application\/pdf;base64,/i, '')
            const binary = atob(base64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            const { dataUrl } = await pdfFirstPageToDataUrl(bytes.buffer, 1.4)
            if (!cancelled && dataUrl) {
              setPdfDataUrls((prev) => ({ ...prev, [p]: dataUrl }))
            }
          } catch {
            // ignore single pdf preview failure
          }
        })()
      }
    }
    if ((detailOpen || imagesOpen) && imagePaths.length > 0) loadDataUrls()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailOpen, imagesOpen, imagePaths])

  useEffect(() => {
    if (!selected) return
    const cfg = getPlotConfig(selected)
    if (!cfg?.parameters) {
      plotForm.resetFields()
      return
    }
    const initial: Record<string, unknown> = {}
    for (const p of cfg.parameters) {
      if (p.default !== undefined) {
        initial[p.name] = p.default
      }
    }
    plotForm.setFieldsValue(initial)
  }, [selected, docsMap, plotForm, getPlotConfig])

  // 详情抽屉：加载 _pipeline 解读稿（中英）
  useEffect(() => {
    if (!detailOpen || !selected?.outputDir) return
    setInterpNoteZh(selected.interpretationNotes?.zh || '')
    setInterpNoteEn(selected.interpretationNotes?.en || '')
    setInterpFileZh('')
    setInterpFileEn('')
    setInterpLoading(true)
    const paths = selected.interpretationPaths || defaultInterpretationPaths(selected.outputDir)
    let cancelled = false
    void Promise.all([
      paths.zh ? window.electronAPI.readFile(paths.zh) : Promise.resolve({ success: false as const, content: '' }),
      paths.en ? window.electronAPI.readFile(paths.en) : Promise.resolve({ success: false as const, content: '' }),
    ]).then(([rzh, ren]) => {
      if (cancelled) return
      setInterpFileZh(rzh.success && rzh.content ? rzh.content : '')
      setInterpFileEn(ren.success && ren.content ? ren.content : '')
      setInterpLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [detailOpen, selected?.id, selected?.outputDir, selected?.interpretationPaths?.zh, selected?.interpretationPaths?.en])

  const saveInterpretationNotes = useCallback(() => {
    if (!selected) return
    updateRunRecord(selected.id, {
      interpretationNotes: {
        ...(selected.interpretationNotes || {}),
        zh: interpNoteZh,
        en: interpNoteEn,
      },
    })
    message.success('已保存补充说明')
    refresh()
    const updated = listRunHistory().find((r) => r.id === selected.id)
    if (updated) setSelected(updated)
  }, [selected, interpNoteZh, interpNoteEn])

  const escapeRString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

  const toRValue = (value: unknown): string => {
    if (value === undefined) return 'NULL'
    if (value === null) return 'NULL'
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
    if (Array.isArray(value)) {
      const items = value.map((v) => toRValue(v))
      return `c(${items.join(', ')})`
    }
    return `"${escapeRString(String(value))}"`
  }

  const parseArrayValue = (value: string): string[] =>
    value
      .split(/\r?\n|,/)
      .map((v) => v.trim())
      .filter(Boolean)

  const buildPlotScript = (record: RunRecord, cfg: PlotConfig, params: Record<string, unknown>) => {
    const pkg = cfg.packageName || record.packageName
    const rdsParam = cfg.rdsParamName || 'rds_path'
    const outParam = cfg.outDirParamName || 'outDir'
    const rdsPath = cfg.rdsFile.startsWith('/') || /^[A-Za-z]:\\/.test(cfg.rdsFile)
      ? cfg.rdsFile
      : `${record.outputDir.replace(/[/\\]$/, '')}/${cfg.rdsFile}`

    if (cfg.scriptTemplate) {
      let tpl = cfg.scriptTemplate
      const replaceAll = (k: string, v: string) => {
        tpl = tpl.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v)
      }
      replaceAll('rds_path', rdsPath)
      replaceAll('out_dir', record.outputDir)
      for (const [k, v] of Object.entries(params)) {
        replaceAll(k, String(v))
      }
      return tpl
    }

    const mergedParams: Record<string, unknown> = {
      [rdsParam]: rdsPath,
      [outParam]: record.outputDir,
      ...params,
    }
    const paramList = Object.entries(mergedParams)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k} = ${toRValue(v)}`)
      .join(', ')

    const pkgLine = pkg
      ? `if (!requireNamespace("${escapeRString(pkg)}", quietly = TRUE)) stop("Package ${escapeRString(pkg)} not found")\n` +
        `library("${escapeRString(pkg)}", character.only = TRUE)\n`
      : ''

    return `${pkgLine}${cfg.plotFunction}(${paramList})\n`
  }

  const columns: ColumnsType<RunRecord> = useMemo(
    () => [
      {
        title: '时间',
        dataIndex: 'startedAt',
        key: 'startedAt',
        width: 180,
        render: (v: number) => new Date(v).toLocaleString(),
      },
      {
        title: '包',
        dataIndex: 'packageName',
        key: 'packageName',
        width: 140,
        render: (v?: string) => v || '-',
      },
      {
        title: '函数',
        dataIndex: 'functionName',
        key: 'functionName',
        render: (name: string, r: RunRecord) => (
          <Space size={4} wrap>
            {r.runKind === 'pipeline' && <Tag color="blue">Pipeline</Tag>}
            <span>{name}</span>
          </Space>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 110,
        render: (s: RunStatus) =>
          s === 'success' ? <Tag color="green">成功</Tag> : s === 'error' ? <Tag color="red">失败</Tag> : <Tag>运行中</Tag>,
      },
      {
        title: '操作',
        key: 'actions',
        width: 140,
        render: (_: unknown, r: RunRecord) => (
          <Space>
            <Button
              size="small"
              onClick={() => {
                setSelected(r)
                setDetailOpen(true)
              }}
            >
              详情
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                deleteRunRecord(r.id)
                message.success('已删除')
              }}
            />
          </Space>
        ),
      },
    ],
    []
  )

  return (
    <>
      <Modal
        title={
          <Space>
            <HistoryOutlined />
            <span>运行记录</span>
          </Space>
        }
        open={open}
        onCancel={onClose}
        footer={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <Button onClick={refresh} loading={loading}>
                刷新
              </Button>
              <Button
                danger
                onClick={() => {
                  clearRunHistory()
                  message.success('已清空')
                }}
              >
                清空
              </Button>
            </Space>
            <Button onClick={onClose}>关闭</Button>
          </Space>
        }
        width={920}
      >
        <div className={styles.runHistory}>
          <Table<RunRecord>
            rowKey="id"
            dataSource={records}
            columns={columns}
            loading={loading}
            size="small"
            pagination={{ pageSize: 8 }}
          />
        </div>
      </Modal>

      <Drawer
        title={selected ? `${selected.functionName}（${new Date(selected.startedAt).toLocaleString()}）` : '详情'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={900}
        extra={
          <Space>
            <Button
              onClick={async () => {
                if (!selected) return
                try {
                  await navigator.clipboard.writeText(selected.script)
                  message.success('脚本已复制')
                } catch {
                  message.warning('复制失败，可手动全选复制')
                }
              }}
            >
              复制脚本
            </Button>
            <Button
              onClick={async () => {
                if (!selected) return
                const savePath = await window.electronAPI.selectSavePath({
                  defaultPath: `${selected.functionName}.R`,
                  filters: [{ name: 'R Script', extensions: ['R', 'r'] }],
                })
                if (!savePath) return
                const w = await window.electronAPI.writeFile(savePath, selected.script)
                if (w.success) message.success('已保存脚本')
                else message.error(w.error || '保存失败')
              }}
            >
              保存脚本
            </Button>
            {getPlotConfig(selected) && (
              <Button
                type="primary"
                loading={plotting}
                onClick={async () => {
                  if (!selected) return
                  const cfg = getPlotConfig(selected)
                  if (!cfg) return
                  if (!cfg.plotFunction && !cfg.scriptTemplate) {
                    message.warning('未配置绘图函数或脚本模板')
                    return
                  }
                  const values = plotForm.getFieldsValue()
                  const normalized: Record<string, unknown> = {}
                  for (const p of cfg.parameters || []) {
                    const v = values[p.name]
                    if (v === undefined || v === null || v === '') continue
                    if (p.type === 'array') {
                      normalized[p.name] = parseArrayValue(String(v))
                    } else {
                      normalized[p.name] = v
                    }
                  }
                  const script = buildPlotScript(selected, cfg, normalized)
                  setPlotting(true)
                  try {
                    const res = await window.electronAPI.runRScript(selected.outputDir, script)
                    if (res.success) {
                      message.success('已更新图像')
                      setImagesOpen(true)
                      setImagePaths([])
                    } else {
                      message.error(res.error || '绘图失败')
                    }
                  } finally {
                    setPlotting(false)
                  }
                }}
              >
                更新图像
              </Button>
            )}
          </Space>
        }
      >
        {selected && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <b>包：</b> {selected.packageName || '-'} &nbsp;&nbsp; <b>状态：</b> {selected.status}
              <br />
              <b>输出目录：</b> {selected.outputDir}
              {selected.error && (
                <>
                  <br />
                  <b style={{ color: '#ff4d4f' }}>错误：</b> {selected.error}
                </>
              )}
            </div>
            {selected.params != null && Object.keys(selected.params).length > 0 && (
              <>
                <Divider />
                <div>
                  <b>运行参数</b>
                  <div style={{ marginTop: 8, padding: 12, background: '#fafafa', borderRadius: 6 }}>
                    {Object.entries(selected.params).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 4, fontSize: 13 }}>
                        <span style={{ color: '#666' }}>{k}:</span>{' '}
                        {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            <Divider />
            <div>
              <Space wrap align="center">
                <b>结果解读（中英草稿）</b>
                <Button type="primary" onClick={() => setInterpretModalOpen(true)}>
                  文档视图
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    if (!selected) return
                    const p =
                      selected.interpretationPaths?.zh || defaultInterpretationPaths(selected.outputDir).zh
                    const r = await window.electronAPI.showItemInFolder(p)
                    if (!r.success) message.warning(r.error || '无法打开')
                  }}
                >
                  在文件夹中显示
                </Button>
              </Space>
              <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                点击「文档视图」打开弹窗：纸张式阅读自动解读稿，并在弹窗底部填写仅保存在本机的补充说明。
              </div>
              {interpLoading && (
                <div style={{ marginTop: 8 }}>
                  <Spin size="small" /> <span style={{ marginLeft: 8, color: '#8c8c8c' }}>正在加载解读稿…</span>
                </div>
              )}
            </div>
            {selected && (
              <InterpretationDocModal
                open={interpretModalOpen}
                onClose={() => setInterpretModalOpen(false)}
                title="结果解读与补充说明"
                loading={interpLoading}
                zhContent={interpFileZh}
                enContent={interpFileEn}
                showNotes
                noteZh={interpNoteZh}
                noteEn={interpNoteEn}
                onNoteZhChange={setInterpNoteZh}
                onNoteEnChange={setInterpNoteEn}
                onSaveNotes={saveInterpretationNotes}
                onShowInFolder={async () => {
                  if (!selected) return
                  const p =
                    selected.interpretationPaths?.zh || defaultInterpretationPaths(selected.outputDir).zh
                  const r = await window.electronAPI.showItemInFolder(p)
                  if (!r.success) message.warning(r.error || '无法打开')
                }}
              />
            )}
            <Divider />
            <TextArea className={styles.code} value={selected.script} autoSize={{ minRows: 18, maxRows: 28 }} readOnly />
            {getPlotConfig(selected) ? (
              <>
                <Divider />
                <div>
                  <b>绘图参数</b>
                </div>
                <Form form={plotForm} layout="vertical">
                  {(getPlotConfig(selected)?.parameters || []).map((p) => {
                    if (p.type === 'number') {
                      return (
                        <Form.Item key={p.name} name={p.name} label={p.name} extra={p.description}>
                          <InputNumber min={p.min} max={p.max} style={{ width: '100%' }} placeholder={p.placeholder} />
                        </Form.Item>
                      )
                    }
                    if (p.type === 'boolean') {
                      return (
                        <Form.Item key={p.name} name={p.name} label={p.name} valuePropName="checked" extra={p.description}>
                          <Switch />
                        </Form.Item>
                      )
                    }
                    if (p.type === 'select') {
                      return (
                        <Form.Item key={p.name} name={p.name} label={p.name} extra={p.description}>
                          <Select placeholder={p.placeholder}>
                            {(p.options || []).map((opt) => (
                              <Option key={opt} value={opt}>
                                {opt}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                      )
                    }
                    if (p.type === 'array') {
                      return (
                        <Form.Item key={p.name} name={p.name} label={p.name} extra={p.description || '每行一个值'}>
                          <TextArea placeholder={p.placeholder} autoSize={{ minRows: 3, maxRows: 6 }} />
                        </Form.Item>
                      )
                    }
                    return (
                      <Form.Item key={p.name} name={p.name} label={p.name} extra={p.description}>
                        <Input placeholder={p.placeholder} />
                      </Form.Item>
                    )
                  })}
                </Form>
              </>
            ) : (
              <>
                <Divider />
                <div style={{ color: '#999' }}>未配置绘图参数（请在 function-docs.json 中添加 plotConfig）</div>
              </>
            )}
            {selected.outputDir && (
              <>
                <Divider />
                <div>
                  <b>生成图片</b>
                  {imagePaths.length === 0 ? (
                    <div style={{ marginTop: 8 }}><Empty description="暂无图片或 PDF" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
                  ) : (
                    <Image.PreviewGroup>
                      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                        {imagePaths.map((p) => (
                          <div key={p} style={{ textAlign: 'center' }}>
                            {isImageFile(p) ? (
                              <div>
                                {imageDataUrls[p] ? (
                                  <Image
                                    src={imageDataUrls[p]}
                                    alt={p}
                                    style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain', borderRadius: 6 }}
                                  />
                                ) : (
                                  <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                                    加载中...
                                  </div>
                                )}
                                {onEditImageInCanvas && (
                                  <Button
                                    type="primary"
                                    size="small"
                                    icon={<EditOutlined />}
                                    style={{ marginTop: 6 }}
                                    onClick={() => {
                                      onEditImageInCanvas(p, {
                                        outputDir: selected.outputDir,
                                        functionName: selected.functionName,
                                        packageName: selected.packageName,
                                        rdsFile: (selected.params?.rds_file ?? selected.params?.rdsFile) as string | undefined,
                                        sourceParams: selected.params,
                                      })
                                      setImagesOpen(false)
                                      setDetailOpen(false)
                                      onClose()
                                    }}
                                  >
                                    编辑
                                  </Button>
                                )}
                              </div>
                            ) : isPdfFile(p) ? (
                              <div>
                                {pdfDataUrls[p] ? (
                                  <Image
                                    src={pdfDataUrls[p]}
                                    alt={p}
                                    style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain', borderRadius: 6 }}
                                  />
                                ) : (
                                  <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <FilePdfOutlined style={{ fontSize: 36, color: '#ff4d4f' }} />
                                  </div>
                                )}
                                {onEditImageInCanvas && (
                                  <Button
                                    type="primary"
                                    size="small"
                                    icon={<EditOutlined />}
                                    style={{ marginTop: 6 }}
                                    onClick={() => {
                                      onEditImageInCanvas(p, {
                                        outputDir: selected.outputDir,
                                        functionName: selected.functionName,
                                        packageName: selected.packageName,
                                        rdsFile: (selected.params?.rds_file ?? selected.params?.rdsFile) as string | undefined,
                                        sourceParams: selected.params,
                                      })
                                      setImagesOpen(false)
                                      setDetailOpen(false)
                                      onClose()
                                    }}
                                  >
                                    编辑
                                  </Button>
                                )}
                              </div>
                            ) : null}
                            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{p.split(/[/\\]/).pop()}</div>
                          </div>
                        ))}
                      </div>
                    </Image.PreviewGroup>
                  )}
                </div>
              </>
            )}
          </Space>
        )}
      </Drawer>

      <Modal
        title="生成图片"
        open={imagesOpen}
        onCancel={() => setImagesOpen(false)}
        footer={null}
        width={900}
      >
        {imagePaths.length === 0 ? (
          <Empty description="暂无图片或PDF" />
        ) : (
          <Image.PreviewGroup>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {imagePaths.map((p) => (
                <div key={p} style={{ textAlign: 'center' }}>
                  {isImageFile(p) ? (
                    <div>
                      {imageDataUrls[p] ? (
                        <Image
                          src={imageDataUrls[p]}
                          alt={p}
                          style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }}
                        />
                      ) : (
                        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                          加载中...
                        </div>
                      )}
                      {onEditImageInCanvas && selected && (
                        <Button
                          type="primary"
                          size="small"
                          icon={<EditOutlined />}
                          style={{ marginTop: 8 }}
                          onClick={() => {
                            onEditImageInCanvas(p, {
                              outputDir: selected.outputDir,
                              functionName: selected.functionName,
                              packageName: selected.packageName,
                              rdsFile: (selected.params?.rds_file ?? selected.params?.rdsFile) as string | undefined,
                              sourceParams: selected.params,
                            })
                            setImagesOpen(false)
                            setDetailOpen(false)
                            onClose()
                          }}
                        >
                          编辑
                        </Button>
                      )}
                    </div>
                  ) : isPdfFile(p) ? (
                    <div>
                      {pdfDataUrls[p] ? (
                        <Image
                          src={pdfDataUrls[p]}
                          alt={p}
                          style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }}
                        />
                      ) : (
                        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <FilePdfOutlined style={{ fontSize: 44, color: '#ff4d4f' }} />
                        </div>
                      )}
                      {onEditImageInCanvas && selected && (
                        <Button
                          type="primary"
                          size="small"
                          icon={<EditOutlined />}
                          style={{ marginTop: 8 }}
                          onClick={() => {
                            onEditImageInCanvas(p, {
                              outputDir: selected.outputDir,
                              functionName: selected.functionName,
                              packageName: selected.packageName,
                              rdsFile: (selected.params?.rds_file ?? selected.params?.rdsFile) as string | undefined,
                              sourceParams: selected.params,
                            })
                            setImagesOpen(false)
                            setDetailOpen(false)
                            onClose()
                          }}
                        >
                          编辑
                        </Button>
                      )}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                    {p.split(/[/\\]/).pop()}
                  </div>
                </div>
              ))}
            </div>
          </Image.PreviewGroup>
        )}
      </Modal>

    </>
  )
}

