import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addRunRecord, newRunRecordId, updateRunRecord } from '../../stores/runHistoryStore'
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
} from 'antd'
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import type { ParameterInfo } from '../../types/pipeline'
import { ParameterForm, type ParameterFormValue } from '../SharedParameterForm'
import InterpretationDocModal from '../InterpretationDocModal'
import { PipelineComposerCanvas } from './PipelineComposerCanvas'
import type { ComposerModuleDef, PipelineDefs } from './pipelineComposerTypes'
import {
  applyUpstreamOutputsToParams,
  findModuleDef,
  firstFn,
  inferModuleOutputs,
  moduleDisplayTitle,
  newComposerNodeId,
  runRScriptAndWait,
  topologicalOrderTemplates,
  type ComposerNodeData,
  type ModuleOutputs,
} from './pipelineComposerUtils'
import styles from './index.module.less'

const { Text } = Typography

const UNICODE_TOKEN_RE = /<U\+([0-9A-Fa-f]{4,6})>/g
function decodeUnicodeTokensInString(input: string): string {
  if (!input.includes('<U+')) return input
  return input.replace(UNICODE_TOKEN_RE, (_, hex: string) => {
    const codePoint = Number.parseInt(hex, 16)
    if (!Number.isFinite(codePoint)) return _
    return String.fromCodePoint(codePoint)
  })
}

function isComposerAtomicModule(name: string, description?: string): boolean {
  const n = name.trim().toLowerCase()
  const d = (description ?? '').trim()
  if (!n) return false
  if (n.startsWith('transcriptome_redraw_')) return false
  if (n.includes('pipeline')) return false
  if (/[一二三四五六七八九十]?键流程/.test(d) || d.includes('流程：')) return false
  return true
}

function decodeUnicodeTokensDeep<T>(value: T): T {
  if (typeof value === 'string') return decodeUnicodeTokensInString(value) as T
  if (Array.isArray(value)) return value.map((v) => decodeUnicodeTokensDeep(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = decodeUnicodeTokensDeep(v)
    }
    return out as T
  }
  return value
}

type StepRunStatus = 'running' | 'success' | 'failed'
type StepStatus = {
  step_id: string
  name?: string
  status?: StepRunStatus
  started_at?: string | null
  ended_at?: string | null
  message?: string | null
  outputs?: Record<string, unknown>
}

const DAGRE_NODE_WIDTH = 280
const DAGRE_NODE_HEIGHT = 86

function layoutVertical(stepIds: string[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: 'TB',
    ranksep: 36, // 节点间距（越小越紧凑）
    nodesep: 18,
    marginx: 20,
    marginy: 20,
  })

  stepIds.forEach((id) => g.setNode(id, { width: DAGRE_NODE_WIDTH, height: DAGRE_NODE_HEIGHT }))
  for (let i = 0; i < stepIds.length - 1; i++) {
    g.setEdge(stepIds[i], stepIds[i + 1])
  }
  dagre.layout(g)
  const pos: Record<string, { x: number; y: number }> = {}
  stepIds.forEach((id) => {
    const n = g.node(id) as { x: number; y: number } | undefined
    if (!n) return
    // dagre 给的是中心点，需要转成左上角坐标
    pos[id] = { x: n.x - DAGRE_NODE_WIDTH / 2, y: n.y - DAGRE_NODE_HEIGHT / 2 }
  })
  return pos
}

type DatasetType = 'count' | 'tpm' | 'expr' | 'geo'
type DatasetItem = {
  type?: DatasetType
  prefix?: string
  geo_id?: string
  group_file?: string
  // count
  count_file?: string
  species?: 'human' | 'mouse'
  // 可选：GeneID -> Symbol 转换（count / tpm / expr 均支持）
  // 后端触发逻辑：当 annot_file 存在时会进行转换（除非显式传入 do_convert_geneid=FALSE）
  annot_file?: string
  geneid_col?: string
  symbol_col?: string
  // tpm/expr
  file?: string
  // geo
  probe_file?: string
  ann_file?: string
  /** ann.txt 中基因 Symbol 列：1-based 列号或表头列名（传给 transcriptome_read_expr_matrix） */
  gene_symbol_col?: string | number
  /** 读取 ann 的最大行数 */
  max_ann_rows?: number
  /** 是否输出 Excel 安全版 */
  write_excel_safe?: boolean
}

/** 与 SharedParameterForm 的 FilePickerInput 一致：由 Form.Item 注入 value/onChange，选文件后调用 onChange 即可回显 */
function DatasetFilePicker({ value, onChange, placeholder }: { value?: string; onChange?: (v: string) => void; placeholder: string }) {
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input readOnly placeholder={placeholder} value={value} />
      <Button
        onClick={async () => {
          const files = await window.electronAPI.selectFiles({ filters: [{ name: 'All Files', extensions: ['*'] }] })
          if (files && files.length > 0) onChange?.(files[0])
        }}
      >
        选择
      </Button>
    </Space.Compact>
  )
}

function DatasetsBuilder({
  form,
  mode = 'any',
}: {
  form: any
  mode?: 'any' | 'geoOnly'
}) {
  const datasets = (Form.useWatch('datasets', form) as DatasetItem[] | undefined) ?? []
  const geoOnly = mode === 'geoOnly'

  return (
    <div style={{ marginBottom: 12 }}>
      <Text strong>datasets（多数据集输入）</Text>
      <div className={styles.hint}>
        {geoOnly
          ? '当前流程仅支持 GEO 数据集：每个数据集需要 probe_file、ann_file、group_file。ann.txt 需含以 ID 开头的表头行；基因列可用 gene_symbol_col 指定列号或列名（默认与 R 包一致）。'
          : '支持混合输入：count 会先转换 TPM（如提供 annot_file 会先做 GeneID->Symbol）；tpm/expr 先读取表达矩阵（如提供 annot_file 也会把行名当作 GeneID->Symbol 转换）；geo 先注释生成表达矩阵。每个数据集都需要 group_file。GEO 的 ann.txt 可用 gene_symbol_col / max_ann_rows / write_excel_safe 与 R 端一致。'}
      </div>
      <Form.List name="datasets">
        {(fields, { add, remove }) => (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {fields.map((field, idx) => {
              const t = datasets?.[idx]?.type
              return (
                <Card
                  key={field.key}
                  size="small"
                  title={`数据集 ${idx + 1}`}
                  extra={
                    <Button danger size="small" onClick={() => remove(field.name)}>
                      删除
                    </Button>
                  }
                >
                  {geoOnly ? (
                    <Form.Item name={[field.name, 'type']} initialValue="geo" hidden>
                      <Input />
                    </Form.Item>
                  ) : (
                    <Form.Item
                      label="type"
                      name={[field.name, 'type']}
                      rules={[{ required: true, message: '请选择 type' }]}
                      initialValue={t || 'expr'}
                    >
                      <Select
                        options={[
                          { label: 'count（原始计数）', value: 'count' },
                          { label: 'tpm（已是 TPM）', value: 'tpm' },
                          { label: 'expr（表达矩阵）', value: 'expr' },
                          { label: 'geo（probe+ann 注释）', value: 'geo' },
                        ]}
                      />
                    </Form.Item>
                  )}

                  <Form.Item label="prefix" name={[field.name, 'prefix']} tooltip="用于输出文件命名（可选）">
                    <Input placeholder="例如：ds1" />
                  </Form.Item>

                  <Form.Item label="geo_id" name={[field.name, 'geo_id']} tooltip="可选：样本列名前缀（传给标准化步骤）">
                    <Input placeholder="例如：GSE123456" />
                  </Form.Item>

                  <Form.Item
                    label="group_file"
                    name={[field.name, 'group_file']}
                    rules={[{ required: true, message: '请选择 group_file' }]}
                  >
                    <DatasetFilePicker placeholder="分组文件（两列：sample, group）" />
                  </Form.Item>

                  {!geoOnly && t === 'count' && (
                    <>
                      <Form.Item
                        label="count_file"
                        name={[field.name, 'count_file']}
                        rules={[{ required: true, message: '请选择 count_file' }]}
                      >
                        <DatasetFilePicker placeholder="count 矩阵文件（首列为基因ID/基因名列；后续为样本count；如需转换请确保列名=geneid_col）" />
                      </Form.Item>
                      <Form.Item label="species" name={[field.name, 'species']} initialValue="human" rules={[{ required: true, message: '请选择 species' }]}>
                        <Select options={[{ label: 'human', value: 'human' }, { label: 'mouse', value: 'mouse' }]} />
                      </Form.Item>

                      <Form.Item label="annot_file（可选：GeneID->Symbol）" name={[field.name, 'annot_file']} tooltip="若你的 count 首列是 GeneID（非 Symbol），填写注释表用于自动转换。否则留空。">
                        <DatasetFilePicker placeholder="注释文件（包含 geneid_col 与 symbol_col 两列）" />
                      </Form.Item>
                      <Space size="small" style={{ width: '100%' }}>
                        <Form.Item label="geneid_col（可选）" name={[field.name, 'geneid_col']} style={{ flex: 1 }}>
                          <Input placeholder="默认 GeneID" />
                        </Form.Item>
                        <Form.Item label="symbol_col（可选）" name={[field.name, 'symbol_col']} style={{ flex: 1 }}>
                          <Input placeholder="默认 Symbol" />
                        </Form.Item>
                      </Space>
                    </>
                  )}

                  {!geoOnly && (t === 'tpm' || t === 'expr' || !t) && (
                    <>
                      <Form.Item
                        label="file"
                        name={[field.name, 'file']}
                        rules={[{ required: true, message: '请选择 file' }]}
                      >
                        <DatasetFilePicker placeholder="表达矩阵文件（首列为基因名/基因ID；后续为样本表达值；如需转换请确保列名=geneid_col）" />
                      </Form.Item>
                      <Form.Item label="annot_file（可选：GeneID->Symbol）" name={[field.name, 'annot_file']} tooltip="若你的表达矩阵首列是 GeneID（非 Symbol），填写注释表用于自动转换；否则留空。">
                        <DatasetFilePicker placeholder="注释文件（包含 geneid_col 与 symbol_col 两列）" />
                      </Form.Item>
                      <Space size="small" style={{ width: '100%' }}>
                        <Form.Item label="geneid_col（可选）" name={[field.name, 'geneid_col']} style={{ flex: 1 }}>
                          <Input placeholder="默认 GeneID" />
                        </Form.Item>
                        <Form.Item label="symbol_col（可选）" name={[field.name, 'symbol_col']} style={{ flex: 1 }}>
                          <Input placeholder="默认 Symbol" />
                        </Form.Item>
                      </Space>
                    </>
                  )}

                  {(geoOnly || t === 'geo') && (
                    <>
                      <Form.Item
                        label="probe_file"
                        name={[field.name, 'probe_file']}
                        rules={[{ required: true, message: '请选择 probe_file' }]}
                      >
                        <DatasetFilePicker placeholder="probe/series_matrix 文件" />
                      </Form.Item>
                      <Form.Item
                        label="ann_file"
                        name={[field.name, 'ann_file']}
                        rules={[{ required: true, message: '请选择 ann_file' }]}
                      >
                        <DatasetFilePicker placeholder="注释文件 ann.txt（表头含 ID 行）" />
                      </Form.Item>
                      <Form.Item
                        label="gene_symbol_col"
                        name={[field.name, 'gene_symbol_col']}
                        tooltip="ann.txt 中基因 Symbol 所在列：填列号（如 11）或表头列名（如 Gene Symbol）。留空则使用 R 默认。"
                      >
                        <Input allowClear placeholder="默认 11；或列名如 Gene Symbol" />
                      </Form.Item>
                      <Form.Item
                        label="max_ann_rows"
                        name={[field.name, 'max_ann_rows']}
                        initialValue={60000}
                        tooltip="读取 ann.txt 的最大行数（大平台注释表可调大）"
                      >
                        <InputNumber min={1} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item
                        label="write_excel_safe"
                        name={[field.name, 'write_excel_safe']}
                        valuePropName="checked"
                        initialValue={true}
                        tooltip="是否额外输出 Excel 安全版（基因名前加单引号）"
                      >
                        <Switch checkedChildren="是" unCheckedChildren="否" />
                      </Form.Item>
                    </>
                  )}
                </Card>
              )
            })}

            <Button
              type="dashed"
              onClick={() => add({ type: geoOnly ? 'geo' : 'expr', prefix: `ds${fields.length + 1}` })}
              block
            >
              添加数据集
            </Button>
          </Space>
        )}
      </Form.List>
    </div>
  )
}

export default function PipelineView() {
  const [loading, setLoading] = useState(false)
  const [defs, setDefs] = useState<PipelineDefs | null>(null)
  const [pipelineName, setPipelineName] = useState<string>('transcriptome_pipeline_single')
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [stepDocs, setStepDocs] = useState<Record<string, ParameterInfo[]>>({})
  const [globalDocs, setGlobalDocs] = useState<Record<string, ParameterInfo[]>>({})
  const [globalForm] = Form.useForm()
  const [stepOverrides, setStepOverrides] = useState<Record<string, ParameterFormValue>>({})
  const [running, setRunning] = useState(false)
  const [runOutputDir, setRunOutputDir] = useState<string | null>(null)
  /** R 包生成的中英解读稿（见 out_dir/_pipeline/interpretation_*.md） */
  const [interpretation, setInterpretation] = useState<{
    zh?: string
    en?: string
    zhPath?: string
    enPath?: string
    metaPath?: string
  } | null>(null)
  const [interpretModalOpen, setInterpretModalOpen] = useState(false)
  const [statusDir, setStatusDir] = useState<string | null>(null)
  const [stepStatusMap, setStepStatusMap] = useState<Record<string, StepStatus>>({})
  const pollingRef = useRef<number | null>(null)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const composerRfRef = useRef<ReactFlowInstance | null>(null)
  /** 当前次 Pipeline 运行对应「运行记录」id，用于成功/失败后回写 */
  const pipelineRunIdRef = useRef<string | null>(null)

  const [uiMode, setUiMode] = useState<'classic' | 'composer'>('classic')
  const [composerSelectedId, setComposerSelectedId] = useState<string | null>(null)
  const [compNodes, setCompNodes, onCompNodesChange] = useNodesState<ComposerNodeData>([])
  const [compEdges, setCompEdges, onCompEdgesChange] = useEdgesState([])
  const [composerModules, setComposerModules] = useState<ComposerModuleDef[]>([])
  const [composerLeftCollapsed, setComposerLeftCollapsed] = useState(true)
  const [composerRightCollapsed, setComposerRightCollapsed] = useState(true)

  const steps = useMemo(() => defs?.[pipelineName]?.steps ?? [], [defs, pipelineName])
  const selectedStep = steps.find((s) => s.step_id === selectedStepId) ?? null

  // 位置只由 steps 决定：避免状态轮询导致重算位置引发“错位/跳动”
  const positions = useMemo(() => {
    const ids = steps.map((s) => s.step_id)
    return layoutVertical(ids)
  }, [steps])

  const pipelineOptions = useMemo(() => {
    if (!defs) return []
    return Object.keys(defs).map((k) => ({ label: defs[k].pipeline_name || k, value: k }))
  }, [defs])

  const nodes: Node[] = useMemo(() => {
    const pickBorder = (sid: string) => {
      const st = stepStatusMap[sid]?.status
      if (st === 'running') return '#1677ff'
      if (st === 'success') return '#52c41a'
      if (st === 'failed') return '#ff4d4f'
      return '#d9d9d9'
    }
    const pickDotClass = (sid: string) => {
      const st = stepStatusMap[sid]?.status
      if (st === 'running') return styles.dotRunning
      if (st === 'success') return styles.dotSuccess
      if (st === 'failed') return styles.dotFailed
      return styles.dotIdle
    }
    return steps.map((s, idx) => ({
      id: s.step_id,
      position: positions[s.step_id] || { x: 0, y: idx * 120 },
      data: {
        label: (
          <div className={styles.nodeLabel}>
            <span className={`${styles.statusDot} ${pickDotClass(s.step_id)}`} />
            <div className={styles.nodeTitle}>{s.step_id}</div>
            <div className={styles.nodeSub}>{s.name}</div>
          </div>
        ),
      },
      style: {
        border: s.step_id === selectedStepId ? `2px solid ${pickBorder(s.step_id)}` : `1px solid ${pickBorder(s.step_id)}`,
        borderRadius: 10,
        padding: 8,
        background: stepStatusMap[s.step_id]?.status === 'failed' ? '#fff2f0' : '#fff',
        width: DAGRE_NODE_WIDTH,
      },
      draggable: false,
    }))
  }, [steps, selectedStepId, stepStatusMap, positions])

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (let i = 0; i < steps.length - 1; i++) {
      const sourceId = steps[i].step_id
      const targetId = steps[i + 1].step_id
      const isActive = stepStatusMap[sourceId]?.status === 'running' || stepStatusMap[targetId]?.status === 'running'
      out.push({
        id: `${sourceId}->${targetId}`,
        source: sourceId,
        target: targetId,
        animated: isActive,
        style: { stroke: isActive ? '#1677ff' : '#bfbfbf', strokeWidth: isActive ? 2 : 1 },
      })
    }
    return out
  }, [steps, stepStatusMap])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    try {
      const api: any = (window as any).electronAPI
      if (!api?.getPipelineDefs) {
        message.error('当前版本未暴露 getPipelineDefs，请重启应用或重新 yarn dev')
        setLoading(false)
        return
      }
      api
        .getPipelineDefs('OmicsFlowCoreFullVersion')
        .then((res: any) => {
          if (cancelled) return
          if (!res?.success || !res?.defs) {
            message.error(res?.error || '获取 pipeline 定义失败')
            return
          }
          // 兼容生产环境出现的 unicode token：将 "<U+XXXX>" 还原为真实字符
          const decoded = decodeUnicodeTokensDeep(res.defs) as PipelineDefs
          setDefs(decoded)
        })
        .finally(() => !cancelled && setLoading(false))
    } catch (e) {
      if (!cancelled) {
        message.error((e as Error)?.message || '获取 pipeline 定义异常')
        setLoading(false)
      }
    }
    return () => {
      cancelled = true
    }
  }, [])

  // multi / multi_any：切换时立即初始化 datasets 为 []，否则 Form.List「添加数据集」不生效
  useEffect(() => {
    if (pipelineName === 'transcriptome_pipeline_multi' || pipelineName === 'transcriptome_pipeline_multi_any') {
      const cur = globalForm.getFieldValue('datasets')
      if (!Array.isArray(cur)) globalForm.setFieldsValue({ datasets: [] })
    }
  }, [pipelineName, globalForm])

  // 选择 pipeline 后：默认选中第一个 step，并加载 pipeline 自身参数
  useEffect(() => {
    // 先清空选中 step，避免切换 pipeline 时短暂显示旧步骤参数
    setSelectedStepId(null)
    if (steps.length > 0) setSelectedStepId(steps[0].step_id)
    // 切换流程类型时：清空右侧“全局参数”和“步骤参数覆盖”
    // 避免上一个 pipeline 的字段/覆盖值残留到当前 pipeline。
    globalForm.resetFields()
    if (pipelineName === 'transcriptome_pipeline_multi' || pipelineName === 'transcriptome_pipeline_multi_any') {
      // resetFields 会把 datasets 字段清掉，因此需要显式重新初始化
      globalForm.setFieldsValue({ datasets: [] })
    }
    setStepOverrides({})
    setStepDocs({})
    setStepStatusMap({})
    setRunOutputDir(null)
    setStatusDir(null)
    setInterpretation(null)

    const loadPipelineDoc = async () => {
      const res = await window.electronAPI.getRFunctionDoc(pipelineName, 'OmicsFlowCoreFullVersion')
      if (res.success && Array.isArray(res.detailedParameters)) {
        setGlobalDocs((prev) => ({ ...prev, [pipelineName]: res.detailedParameters as ParameterInfo[] }))
        // 设置默认值
        ;(res.detailedParameters as ParameterInfo[]).forEach((p) => {
          if (p.default !== undefined) globalForm.setFieldsValue({ [p.name]: p.default })
        })
      }
    }
    loadPipelineDoc().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineName, globalForm])

  // 仅在 steps 变化时 fitView 一次，避免运行中视图跳动
  useEffect(() => {
    if (!rfRef.current) return
    if (!steps || steps.length === 0) return
    // next tick：确保 nodes 已渲染
    const t = window.setTimeout(() => {
      try {
        rfRef.current?.fitView({ padding: 0.12, includeHiddenNodes: true })
      } catch {
        // ignore
      }
    }, 50)
    return () => window.clearTimeout(t)
  }, [pipelineName, steps])

  // 运行时：轮询 status JSON，更新节点状态并自动选中当前 step
  useEffect(() => {
    if (!running || !statusDir) return

    const pollOnce = async () => {
      const list = await window.electronAPI.listFiles(statusDir, { extensions: ['json'], recursive: false })
      if (!list.success || !Array.isArray(list.files)) return

      const nextMap: Record<string, StepStatus> = {}
      for (const f of list.files) {
        const read = await window.electronAPI.readFile(f)
        if (!read.success || !read.content) continue
        try {
          const parsed = JSON.parse(read.content) as StepStatus
          if (parsed?.step_id) nextMap[parsed.step_id] = parsed
        } catch {
          // ignore
        }
      }
      if (Object.keys(nextMap).length > 0) {
        setStepStatusMap(nextMap)
        const runningStep = steps.find((s) => nextMap[s.step_id]?.status === 'running')
        if (runningStep) setSelectedStepId(runningStep.step_id)
        const failedStep = steps.find((s) => nextMap[s.step_id]?.status === 'failed')
        if (!runningStep && failedStep) setSelectedStepId(failedStep.step_id)
      }
    }

    pollOnce().catch(() => {})
    pollingRef.current = window.setInterval(() => {
      pollOnce().catch(() => {})
    }, 1000)

    return () => {
      if (pollingRef.current != null) {
        window.clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [running, statusDir, steps])

  // 选中 step 时：加载该 step 对应函数的参数定义（用于右侧面板）
  useEffect(() => {
    if (!selectedStep) return
    const fn = firstFn(selectedStep)
    if (!fn) return
    if (stepDocs[selectedStep.step_id]) return

    window.electronAPI
      .getRFunctionDoc(fn, 'OmicsFlowCoreFullVersion')
      .then((res) => {
        if (!res.success || !Array.isArray(res.detailedParameters)) return
        setStepDocs((prev) => ({ ...prev, [selectedStep.step_id]: res.detailedParameters as ParameterInfo[] }))
      })
      .catch(() => {})
  }, [selectedStep, stepDocs])

  const overridableParams = useMemo(() => {
    if (!selectedStep) return null
    const allowed = selectedStep.overridable_params
    if (!allowed || allowed.length === 0) return null
    return new Set(allowed)
  }, [selectedStep])

  const selectedStepParams: ParameterInfo[] = useMemo(() => {
    if (!selectedStep) return []
    const base = stepDocs[selectedStep.step_id] ?? []
    if (!overridableParams) return base
    let list = base.filter((p) => overridableParams.has(p.name))
    // multi 流程下 01 的输入来自 datasets，步骤里不展示 probe_file/ann_file 避免重复
    if (
      (pipelineName === 'transcriptome_pipeline_multi' && selectedStep.step_id === '01_geo_annotation') ||
      (pipelineName === 'transcriptome_pipeline_multi_any' && selectedStep.step_id === '01_input_prepare')
    ) {
      list = list.filter((p) => p.name !== 'probe_file' && p.name !== 'ann_file')
    }
    return list
  }, [selectedStep, stepDocs, overridableParams, pipelineName])

  const selectedComposerNode = useMemo(
    () => compNodes.find((n) => n.id === composerSelectedId) ?? null,
    [compNodes, composerSelectedId]
  )
  const selectedComposerModule = useMemo(
    () => (selectedComposerNode ? findModuleDef(composerModules, selectedComposerNode.data.moduleKey) : undefined),
    [selectedComposerNode, composerModules]
  )
  const composerStepParams: ParameterInfo[] = useMemo(() => {
    if (!selectedComposerModule) return []
    return stepDocs[selectedComposerModule.key] ?? []
  }, [selectedComposerModule, stepDocs])

  const recommendNextModules = useMemo(() => {
    if (!selectedComposerModule) return []
    const produces = selectedComposerModule.io?.produces ?? []
    if (!produces.length) return []
    const picked = composerModules.filter((m) => {
      const consumes = m.io?.consumes ?? []
      if (!consumes.length) return false
      return consumes.some((c) => produces.includes(c))
    })
    return picked.slice(0, 12)
  }, [selectedComposerModule, composerModules])

  const canConnectModuleDefs = useCallback(
    (srcMod: ComposerModuleDef, tgtMod: ComposerModuleDef): { ok: boolean; reason?: string; auto?: boolean } => {
      const produces = srcMod.io?.produces ?? []
      const consumes = tgtMod.io?.consumes ?? []
      if (!consumes.length) return { ok: true }
      if (!produces.length) return { ok: false, reason: `上游「${srcMod.title}」未声明产物类型` }
      if (consumes.some((c) => produces.includes(c))) return { ok: true }

      // 自动补链白名单：expr_norm_file -> deg_table_file（通过 heatmap_limma 产出）
      if (consumes.includes('deg_table_file') && produces.includes('expr_norm_file')) {
        return { ok: true, auto: true, reason: '将自动补链：先执行差异分析，再把 deg_table 传给下游' }
      }

      return {
        ok: false,
        reason: `不兼容：上游产物 [${produces.join(', ')}] 不能满足下游输入 [${consumes.join(', ')}]`,
      }
    },
    []
  )

  const checkComposerConnection = useMemo(
    () => (sourceId: string, targetId: string): { ok: boolean; reason?: string; auto?: boolean } => {
      const srcNode = compNodes.find((n) => n.id === sourceId)
      const tgtNode = compNodes.find((n) => n.id === targetId)
      if (!srcNode || !tgtNode) return { ok: false, reason: '未找到节点信息' }
      const srcMod = composerModules.find((m) => m.key === srcNode.data.moduleKey)
      const tgtMod = composerModules.find((m) => m.key === tgtNode.data.moduleKey)
      if (!srcMod || !tgtMod) return { ok: false, reason: '未找到模块定义' }
      return canConnectModuleDefs(srcMod, tgtMod)
    },
    [compNodes, composerModules, canConnectModuleDefs]
  )

  const handleAddRecommendedModule = useCallback(
    (m: ComposerModuleDef) => {
      if (!selectedComposerNode || !selectedComposerModule) return
      const chk = canConnectModuleDefs(selectedComposerModule, m)
      if (!chk.ok) {
        message.warning(chk.reason ?? '无法连接该模块')
        return
      }
      if (chk.auto && chk.reason) {
        message.info(chk.reason)
      }
      const srcId = selectedComposerNode.id
      const srcNode = compNodes.find((n) => n.id === srcId)
      if (!srcNode) return
      const downstreamTargets = compEdges.filter((e) => e.source === srcId).map((e) => e.target)
      const downstreamYs = downstreamTargets
        .map((tid) => compNodes.find((n) => n.id === tid)?.position.y)
        .filter((y): y is number => typeof y === 'number')
      const maxDownY = downstreamYs.length ? Math.max(...downstreamYs) : -Infinity
      const baseY = Math.max(srcNode.position.y, maxDownY)
      const pos = { x: srcNode.position.x, y: baseY + 120 }

      const newId = newComposerNodeId()
      const newNode: Node<ComposerNodeData> = {
        id: newId,
        position: pos,
        data: {
          moduleKey: m.key,
          functionName: m.functionName,
          title: m.title,
          subtitle: m.functionName,
          params: {},
          label: (
            <div className={styles.nodeLabel}>
              <div className={styles.nodeTitle}>{m.title}</div>
              <div className={styles.nodeSub}>{m.functionName}</div>
            </div>
          ),
        },
        style: {
          border: '1px solid #d9d9d9',
          borderRadius: 10,
          padding: 8,
          background: '#fff',
          width: DAGRE_NODE_WIDTH,
        },
      }
      setCompNodes((ns) => [...ns, newNode])
      setCompEdges((eds) =>
        addEdge(
          {
            id: `${srcId}->${newId}`,
            source: srcId,
            target: newId,
            animated: true,
            style: { stroke: '#1677ff', strokeWidth: 2 },
          },
          eds
        )
      )
      setComposerSelectedId(newId)
    },
    [
      selectedComposerNode,
      selectedComposerModule,
      compNodes,
      compEdges,
      canConnectModuleDefs,
      setCompNodes,
      setCompEdges,
    ]
  )

  useEffect(() => {
    if (uiMode !== 'composer') return
    let cancelled = false
    void window.electronAPI.getAllFunctionDocs().then((res) => {
      if (cancelled || !res.success || !Array.isArray(res.docs)) return
      const docs = res.docs as Array<{
        name: string
        package?: string
        description?: string
        category?: string
        detailedParameters?: Array<{ name: string }>
        io?: {
          consumes?: string[]
          produces?: string[]
          bindings?: Record<string, string>
        }
      }>
      const modules = docs
        .filter((d) =>
          d.package === 'OmicsFlowCoreFullVersion' &&
          isComposerAtomicModule(d.name, d.description)
        )
        .map((d) => {
          const rawCat = typeof d.category === 'string' ? d.category.trim() : ''
          const category =
            rawCat ||
            (d.name.startsWith('transcriptome_')
              ? 'transcriptomics'
              : d.name.startsWith('metabolome_') || d.name.startsWith('metabolomics_')
                ? 'metabolomics'
                : 'uncategorized')
          return {
            key: d.name,
            functionName: d.name,
            title: moduleDisplayTitle(d.description, d.name),
            description: d.description,
            category,
            packageName: d.package,
            parameters: Array.isArray(d.detailedParameters) ? d.detailedParameters.map((p) => p.name) : [],
            io: d.io,
          }
        }) as ComposerModuleDef[]
      setComposerModules(modules)
    })
    return () => {
      cancelled = true
    }
  }, [uiMode])

  useEffect(() => {
    if (uiMode !== 'composer' || !composerRfRef.current || compNodes.length === 0) return
    const t = window.setTimeout(() => {
      try {
        composerRfRef.current?.fitView({ padding: 0.12, includeHiddenNodes: true })
      } catch {
        /* ignore */
      }
    }, 60)
    return () => window.clearTimeout(t)
  }, [uiMode, compNodes.length])

  useEffect(() => {
    if (uiMode !== 'composer' || !selectedComposerModule) return
    const sid = selectedComposerModule.key
    const fn = selectedComposerModule.functionName
    if (!fn) return
    if (stepDocs[sid]) return

    window.electronAPI
      .getRFunctionDoc(fn, 'OmicsFlowCoreFullVersion')
      .then((res) => {
        if (!res.success || !Array.isArray(res.detailedParameters)) return
        setStepDocs((prev) => ({ ...prev, [sid]: res.detailedParameters as ParameterInfo[] }))
      })
      .catch(() => {})
  }, [uiMode, selectedComposerModule, stepDocs])

  const pipelineParams: ParameterInfo[] = useMemo(() => {
    const base = globalDocs[pipelineName] ?? []
    // config 与 ... 不在面板里直接展示（config 由流程图节点生成）
    // multi_any / multi 的 datasets 用专用构建器渲染
    const filtered = base.filter(
      (p) =>
        p.name !== 'config' &&
        p.name !== '...' &&
        !(
          (pipelineName === 'transcriptome_pipeline_multi_any' || pipelineName === 'transcriptome_pipeline_multi') &&
          p.name === 'datasets'
        )
    )

    // 如果函数文档没拿到 detailedParameters，multi/multi_any 可能导致 filtered 为空。
    // 这里用已知的 R 函数签名做一个兜底，保证默认参数能渲染出来。
    if (filtered.length > 0) return filtered

    if (pipelineName === 'transcriptome_pipeline_multi_any') {
      return [
        { name: 'out_dir', type: 'directory', default: '.', description: '输出根目录（会生成 01_/02_/... 以及 _pipeline/status）' },
        { name: 'merge_prefix', type: 'string', default: 'merge_any', description: '合并结果文件前缀' },
        { name: 'batch_from_filename', type: 'boolean', default: true, description: '是否从文件名提取 batch（传递给合并函数）' },
        {
          name: 'contrast',
          type: 'tags',
          required: true,
          default: ['Control', 'Disease'],
          options: ['Control', 'Disease'],
          description: 'limma 对比组（必须两组）',
        },
        { name: 'overwrite', type: 'boolean', default: false, description: '是否覆盖输出文件' },
        { name: 'do_combat', type: 'boolean', default: true, description: '是否做 ComBat 批次校正' },
      ]
    }

    if (pipelineName === 'transcriptome_pipeline_multi') {
      return [
        { name: 'out_dir', type: 'directory', default: '.', description: '输出根目录（会生成 01_/02_/... 以及 _pipeline/status）' },
        { name: 'merge_prefix', type: 'string', default: 'merge', description: '合并结果文件前缀' },
        { name: 'batch_from_filename', type: 'boolean', default: true, description: '是否从文件名提取 batch（传递给合并函数）' },
        {
          name: 'contrast',
          type: 'tags',
          required: true,
          default: ['Control', 'Disease'],
          options: ['Control', 'Disease'],
          description: 'limma 对比组（必须两组）',
        },
        { name: 'overwrite', type: 'boolean', default: false, description: '是否覆盖输出文件' },
        { name: 'do_combat', type: 'boolean', default: true, description: '是否做 ComBat 批次校正' },
      ]
    }

    return filtered
  }, [globalDocs, pipelineName])

  const loadDefaultComposerChain = () => {
    const preferred = [
      'transcriptome_read_expr_matrix',
      'transcriptome_normalize_matrix',
      'transcriptome_plot_heatmap_limma',
    ]
    const pick = preferred.map((fn) => composerModules.find((m) => m.functionName === fn)).filter(Boolean)
    if (pick.length < 3) {
      message.warning('模块库尚未准备好，无法载入默认链')
      return
    }
    const stepsTriple = pick as ComposerModuleDef[]
    const positions = [
      { x: 80, y: 20 },
      { x: 80, y: 140 },
      { x: 80, y: 260 },
    ]
    const newNodes: Node<ComposerNodeData>[] = stepsTriple.map((step, i) => {
      const id = newComposerNodeId()
      return {
        id,
        position: positions[i],
        data: {
          moduleKey: step.key,
          functionName: step.functionName,
          title: step.title,
          subtitle: step.functionName,
          params: {},
          label: (
            <div className={styles.nodeLabel}>
              <div className={styles.nodeTitle}>{step.title}</div>
              <div className={styles.nodeSub}>{step.functionName}</div>
            </div>
          ),
        },
        style: {
          border: '1px solid #d9d9d9',
          borderRadius: 10,
          padding: 8,
          background: '#fff',
          width: DAGRE_NODE_WIDTH,
        },
      }
    })
    setCompNodes(newNodes)
    setCompEdges([
      {
        id: `${newNodes[0].id}->${newNodes[1].id}`,
        source: newNodes[0].id,
        target: newNodes[1].id,
        animated: true,
        style: { stroke: '#1677ff', strokeWidth: 2 },
      },
      {
        id: `${newNodes[1].id}->${newNodes[2].id}`,
        source: newNodes[1].id,
        target: newNodes[2].id,
        animated: true,
        style: { stroke: '#1677ff', strokeWidth: 2 },
      },
    ])
    setComposerSelectedId(newNodes[0].id)
  }

  const clearComposerCanvas = () => {
    setCompNodes([])
    setCompEdges([])
    setComposerSelectedId(null)
  }

  const handleRunComposer = async () => {
    try {
      if (running) return
      if (compNodes.length === 0) {
        message.error('请先从左侧拖入至少一个模块')
        return
      }
      const orderResult = topologicalOrderTemplates(compNodes, compEdges)
      if (typeof orderResult === 'object' && 'error' in orderResult) {
        message.error(orderResult.error)
        return
      }
      const order = orderResult as string[]

      const globalValues: Record<string, unknown> = {}

      const outputsByNode: Record<string, ModuleOutputs> = {}

      const userOutDir = (globalValues?.out_dir ?? globalValues?.outDir) as string | undefined
      const recordOutDir =
        typeof userOutDir === 'string' && userOutDir.trim() !== '' && userOutDir.trim() !== '.'
          ? userOutDir.trim()
          : '.'

      setRunning(true)
      setInterpretation(null)
      setRunOutputDir(recordOutDir !== '.' ? recordOutDir : null)

      const jobStartedAt = Date.now()
      const runId = newRunRecordId(jobStartedAt)
      pipelineRunIdRef.current = runId

      const nodeFnList = order
        .map((id) => {
          const n = compNodes.find((x) => x.id === id)
          return n?.data.functionName || '?'
        })
        .join(' → ')

      addRunRecord({
        id: runId,
        functionName: `composer:${nodeFnList}`,
        packageName: 'OmicsFlowCoreFullVersion',
        startedAt: jobStartedAt,
        status: 'running',
        outputDir: recordOutDir,
        script: '',
        params: { uiMode: 'composer', order, globalValues, nodeTemplates: compNodes.map((n) => n.data.functionName) },
        runKind: 'composer',
      })

      const collectOutputs = async (
        fn: string,
        params: Record<string, unknown>,
        baseOutThis: string
      ): Promise<ModuleOutputs> => {
        const guessed = inferModuleOutputs(fn, params, baseOutThis)
        const read = await window.electronAPI.readFile(`${baseOutThis.replace(/\\/g, '/')}/_artifacts.json`)
        if (!read.success || !read.content) return guessed
        try {
          const parsed = JSON.parse(read.content) as {
            function_name?: string
            artifacts?: Record<string, unknown>
          }
          if (!parsed || typeof parsed !== 'object' || !parsed.artifacts) return guessed
          if (parsed.function_name && parsed.function_name !== fn) return guessed
          return { ...guessed, ...(parsed.artifacts as ModuleOutputs) }
        } catch {
          return guessed
        }
      }

      const runOne = async (
        fn: string,
        params: Record<string, unknown>,
        titleForErr: string
      ): Promise<{ ok: boolean; baseOut?: string; outputs?: ModuleOutputs; error?: string }> => {
        const gen = await window.electronAPI.generateRFunctionScript(fn, 'OmicsFlowCoreFullVersion', params, [])
        if (!gen.success || !gen.outputDir || !gen.script) {
          return { ok: false, error: gen.error || `生成脚本失败：${titleForErr}` }
        }
        const baseOutThis =
          typeof userOutDir === 'string' && userOutDir.trim() !== '' && userOutDir.trim() !== '.'
            ? userOutDir.trim().replace(/\\/g, '/')
            : gen.outputDir.replace(/\\/g, '/')
        setRunOutputDir(baseOutThis)
        const result = await runRScriptAndWait(gen.outputDir, gen.script)
        if (!result.success) {
          return { ok: false, error: result.error || `执行失败：${titleForErr}` }
        }
        const outputs = await collectOutputs(fn, params, baseOutThis)
        return { ok: true, baseOut: baseOutThis, outputs }
      }

      for (const nodeId of order) {
        const node = compNodes.find((n) => n.id === nodeId)
        if (!node) continue
        const fn = node.data.functionName
        if (!fn) {
          message.error(`节点 ${node.data.title} 未绑定 R 函数`)
          updateRunRecord(runId, { status: 'error', finishedAt: Date.now(), error: '节点未绑定函数' })
          setRunning(false)
          pipelineRunIdRef.current = null
          return
        }

        let params: Record<string, unknown> = { ...node.data.params }

        const incoming = compEdges.find((e) => e.target === nodeId)
        const upstream = incoming ? outputsByNode[incoming.source] : undefined
        params = applyUpstreamOutputsToParams(fn, params, upstream)

        // 自动补链 MVP：当目标是火山图且上游仅提供表达矩阵时，自动插入差异步骤（heatmap_limma）产出 deg_file
        if (
          fn === 'transcriptome_plot_volcano' &&
          !params.expr_file &&
          (upstream?.expr_file || upstream?.normalize_file) &&
          !upstream?.deg_file
        ) {
          const exprInput = upstream.normalize_file ?? upstream.expr_file
          const autoDegOutDir =
            typeof userOutDir === 'string' && userOutDir.trim() !== '' && userOutDir.trim() !== '.'
              ? userOutDir.trim()
              : undefined
          const autoDegParams: Record<string, unknown> = {
            expr_file: exprInput,
            out_dir: autoDegOutDir ?? '.',
            contrast: ['Control', 'Disease'],
            save_rds: false,
            show_gene_names: false,
          }
          const autoDeg = await runOne('transcriptome_plot_heatmap_limma', autoDegParams, '自动补链：差异分析')
          if (!autoDeg.ok) {
            const err = autoDeg.error || '自动补链失败'
            updateRunRecord(runId, { status: 'error', finishedAt: Date.now(), error: err })
            message.error(err)
            setRunning(false)
            pipelineRunIdRef.current = null
            return
          }
          outputsByNode[nodeId] = { ...(outputsByNode[nodeId] || {}), ...(autoDeg.outputs || {}) }
          params = applyUpstreamOutputsToParams(fn, params, outputsByNode[nodeId])
        }

        // PCA 允许单数据集，但至少需要有表达矩阵输入（input_file）
        if (fn === 'transcriptome_plot_pca' && !params.input_file) {
          params = applyUpstreamOutputsToParams(fn, params, upstream)
          if (!params.input_file) {
            const err = 'PCA 缺少 input_file：请连线到能产出表达矩阵的上游模块，或手动填写 input_file'
            updateRunRecord(runId, { status: 'error', finishedAt: Date.now(), error: err })
            message.error(err)
            setRunning(false)
            pipelineRunIdRef.current = null
            return
          }
        }

        // 兼容旧参数名：部分链路会把表达矩阵放在 expr_file（如标准化输出）
        // 但 transcriptome_plot_pca() 使用 input_file 参数名；若继续带 expr_file 会触发 R 的 unused argument
        if (fn === 'transcriptome_plot_pca') {
          if (!params.input_file && typeof params.expr_file === 'string' && params.expr_file.trim()) {
            params.input_file = params.expr_file.trim()
          }
          if ('expr_file' in params) delete params.expr_file
        }

        const ran = await runOne(fn, params, node.data.title)
        if (!ran.ok) {
          const err = ran.error || '脚本失败'
          updateRunRecord(runId, {
            status: 'error',
            finishedAt: Date.now(),
            error: err === '分析已取消' ? '分析已取消' : err,
          })
          if (err !== '分析已取消') message.error(err)
          else message.info('分析已取消')
          setRunning(false)
          pipelineRunIdRef.current = null
          return
        }
        outputsByNode[nodeId] = { ...(outputsByNode[nodeId] || {}), ...(ran.outputs || {}) }
      }

      message.success('模块化流程执行完成')
      updateRunRecord(runId, { status: 'success', finishedAt: Date.now() })
      pipelineRunIdRef.current = null
      setRunning(false)
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in (e as any)) return
      const rid = pipelineRunIdRef.current
      if (rid) {
        pipelineRunIdRef.current = null
        updateRunRecord(rid, {
          status: 'error',
          finishedAt: Date.now(),
          error: (e as Error)?.message || '运行时出错',
        })
      }
      message.error((e as Error)?.message || '运行时出错')
      setRunning(false)
    }
  }

  const handleRun = async () => {
    try {
      if (running) return
      const globalValues = await globalForm.validateFields() as Record<string, unknown>
      // 可选参数若被清空，不要传空字符串给 R（尤其是 gene_symbol_col）
      if (globalValues.gene_symbol_col === '' || globalValues.gene_symbol_col == null) {
        delete globalValues.gene_symbol_col
      }
      if (Array.isArray(globalValues.datasets)) {
        globalValues.datasets = globalValues.datasets.map((ds: Record<string, unknown>) => {
          const d = { ...ds }
          if (d.gene_symbol_col === '' || d.gene_symbol_col == null) delete d.gene_symbol_col
          return d
        })
      }
      if (pipelineName === 'transcriptome_pipeline_multi_any' || pipelineName === 'transcriptome_pipeline_multi') {
        const ds = globalValues.datasets as DatasetItem[] | undefined
        if (!Array.isArray(ds) || ds.length === 0) {
          message.error('请先在 datasets 中至少添加 1 个数据集')
          return
        }
      }
      const config: Record<string, unknown> = {}
      steps.forEach((s) => {
        const key = s.config_key
        if (!key) return
        const v = stepOverrides[key]
        if (v && typeof v === 'object' && Object.keys(v).length > 0) {
          config[key] = v
        }
      })

      const params: Record<string, unknown> = {
        ...globalValues,
        config: Object.keys(config).length ? config : null,
      }

      // 生成脚本并异步运行（这样才能实时轮询 status）
      setStepStatusMap({})
      setInterpretation(null)
      setRunning(true)
      const gen = await window.electronAPI.generateRFunctionScript(pipelineName, 'OmicsFlowCoreFullVersion', params, [])
      if (!gen.success || !gen.outputDir || !gen.script) {
        setRunning(false)
        message.error(gen.error || '生成 R 脚本失败')
        return
      }

      // out_dir 若为 '.' 或空，则 pipeline 会写到脚本 cwd（gen.outputDir）
      const userOutDir = (params?.out_dir ?? params?.outDir) as string | undefined
      const baseOut =
        typeof userOutDir === 'string' && userOutDir.trim() !== '' && userOutDir.trim() !== '.'
          ? userOutDir.trim()
          : gen.outputDir

      setRunOutputDir(baseOut)
      const statusDirPath = `${baseOut.replace(/\\/g, '/')}/_pipeline/status`
      const clearRes = await window.electronAPI.clearPipelineStatusDir(statusDirPath)
      if (!clearRes.success) {
        message.warning(clearRes.error || '无法清空上次步骤状态，流程图可能短暂显示旧状态')
      }
      if (steps.length > 0) {
        setSelectedStepId(steps[0].step_id)
      }
      setStatusDir(statusDirPath)

      const startedAt = Date.now()
      const runId = newRunRecordId(startedAt)
      pipelineRunIdRef.current = runId
      addRunRecord({
        id: runId,
        functionName: pipelineName,
        packageName: 'OmicsFlowCoreFullVersion',
        startedAt,
        status: 'running',
        outputDir: baseOut,
        script: gen.script,
        params,
        runKind: 'pipeline',
      })

      const cleanup = window.electronAPI.onRunRScriptResult?.(async (result) => {
        cleanup?.()
        // 结束前拉取一次 status，确保失败的那一步被标红并选中
        try {
          const list = await window.electronAPI.listFiles(statusDirPath, { extensions: ['json'], recursive: false })
          if (list.success && Array.isArray(list.files)) {
            const nextMap: Record<string, StepStatus> = {}
            for (const f of list.files) {
              const read = await window.electronAPI.readFile(f)
              if (read.success && read.content) {
                try {
                  const parsed = JSON.parse(read.content) as StepStatus
                  if (parsed?.step_id) nextMap[parsed.step_id] = parsed
                } catch {
                  /* ignore */
                }
              }
            }
            if (Object.keys(nextMap).length > 0) {
              setStepStatusMap(nextMap)
              const failedStep = steps.find((s) => nextMap[s.step_id]?.status === 'failed')
              if (failedStep) setSelectedStepId(failedStep.step_id)
            }
          }
        } catch {
          /* ignore */
        }
        setRunning(false)
        const rid = pipelineRunIdRef.current
        pipelineRunIdRef.current = null
        if (result.success && result.outputDir) {
          message.success(`Pipeline 运行完成：${baseOut}`)
          const normBase = baseOut.replace(/\\/g, '/')
          const zhPath = `${normBase}/_pipeline/interpretation_zh.md`
          const enPath = `${normBase}/_pipeline/interpretation_en.md`
          const metaPath = `${normBase}/_pipeline/interpretation_meta.json`
          if (rid) {
            updateRunRecord(rid, {
              status: 'success',
              finishedAt: Date.now(),
              interpretationPaths: { zh: zhPath, en: enPath, meta: metaPath },
            })
          }
          void Promise.all([window.electronAPI.readFile(zhPath), window.electronAPI.readFile(enPath)]).then(
            ([rzh, ren]) => {
              setInterpretation({
                zh: rzh.success && rzh.content ? rzh.content : undefined,
                en: ren.success && ren.content ? ren.content : undefined,
                zhPath,
                enPath,
                metaPath,
              })
            }
          )
        } else {
          const err = result.error || '脚本执行失败'
          if (rid) {
            updateRunRecord(rid, {
              status: 'error',
              finishedAt: Date.now(),
              error: err === '分析已取消' ? '分析已取消' : err,
            })
          }
          if (err !== '分析已取消') message.error(err)
          else message.info('分析已取消')
        }
      })

      const run = await window.electronAPI.runRScript(gen.outputDir, gen.script)
      if (!run.started) {
        cleanup?.()
        setRunning(false)
        const rid = pipelineRunIdRef.current
        pipelineRunIdRef.current = null
        if (rid) {
          updateRunRecord(rid, {
            status: 'error',
            finishedAt: Date.now(),
            error: run.error || '启动失败',
          })
        }
        message.error(run.error || '启动失败')
      }
    } catch (e) {
      // 表单校验失败不提示
      if (e && typeof e === 'object' && 'errorFields' in (e as any)) return
      const rid = pipelineRunIdRef.current
      if (rid) {
        pipelineRunIdRef.current = null
        updateRunRecord(rid, {
          status: 'error',
          finishedAt: Date.now(),
          error: (e as Error)?.message || '运行时出错',
        })
      }
      message.error((e as Error)?.message || '运行时出错')
      setRunning(false)
    }
  }

  const handleCancel = async () => {
    if (!running) return
    await window.electronAPI.cancelCurrentRScript()
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.topBar}>
        <Text strong>Pipeline</Text>
        <Segmented
          value={uiMode}
          onChange={(v) => setUiMode(v as 'classic' | 'composer')}
          options={[
            { label: '经典一键', value: 'classic' },
            { label: '模块化编排', value: 'composer' },
          ]}
          disabled={running}
        />
        {uiMode === 'classic' ? (
          <Select
            style={{ width: 360 }}
            loading={loading}
            value={pipelineName}
            options={pipelineOptions}
            onChange={(v) => setPipelineName(v)}
            disabled={running}
          />
        ) : (
          <Text type="secondary" style={{ maxWidth: 420, fontSize: 12 }}>
            不调用包装函数；按画布顺序依次执行各节点对应 R 单函数。连线仅允许「上一步→下一步」。expr 路径按 prefix/out_dir 自动衔接，若与 R 包实际文件名不一致请在节点表单里手动指定 expr_file。
          </Text>
        )}
        <Button
          type="primary"
          onClick={() => (uiMode === 'classic' ? handleRun() : handleRunComposer())}
          disabled={loading || !defs || running}
        >
          {running ? '运行中…' : uiMode === 'classic' ? '运行 Pipeline' : '运行模块化流程'}
        </Button>
        <Button onClick={handleCancel} disabled={!running}>
          取消
        </Button>
        {uiMode === 'composer' && !running && (
          <Space>
            <Button size="small" onClick={() => setComposerLeftCollapsed((v) => !v)}>
              {composerLeftCollapsed ? '展开左侧模块库' : '收起左侧模块库'}
            </Button>
            <Button size="small" onClick={() => setComposerRightCollapsed((v) => !v)}>
              {composerRightCollapsed ? '展开右侧参数区' : '收起右侧参数区'}
            </Button>
            <Button size="small" onClick={loadDefaultComposerChain} disabled={composerModules.length < 3}>
              载入默认三步骤
            </Button>
            <Button size="small" danger type="text" onClick={clearComposerCanvas}>
              清空画布
            </Button>
          </Space>
        )}
        {running && runOutputDir && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            输出：{runOutputDir}
          </Text>
        )}
      </div>

      <div className={styles.main}>
        {uiMode === 'classic' ? (
          <>
            <div className={styles.graph}>
              {loading ? (
                <div style={{ padding: 24 }}>
                  <Spin />
                </div>
              ) : (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onInit={(instance) => {
                    rfRef.current = instance
                    try {
                      instance.fitView({ padding: 0.12, includeHiddenNodes: true })
                    } catch {
                      // ignore
                    }
                  }}
                  onNodeClick={(_, node) => setSelectedStepId(String(node.id))}
                  defaultEdgeOptions={{ type: 'straight' }}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={!running}
                >
                  <Background />
                  <Controls />
                </ReactFlow>
              )}
            </div>

            <div className={styles.panel}>
              <Card size="small" title="全局参数（Pipeline 入参）">
                {pipelineParams.length === 0 &&
                pipelineName !== 'transcriptome_pipeline_multi' &&
                pipelineName !== 'transcriptome_pipeline_multi_any' ? (
                  <div className={styles.hint}>暂无可配置全局参数</div>
                ) : (
                  <>
                    {pipelineParams.length > 0 && <ParameterForm form={globalForm} parameters={pipelineParams} />}
                    {(pipelineName === 'transcriptome_pipeline_multi_any' || pipelineName === 'transcriptome_pipeline_multi') && (
                      <Form form={globalForm} layout="vertical" style={{ marginTop: 8 }}>
                        {pipelineName === 'transcriptome_pipeline_multi_any' && <DatasetsBuilder form={globalForm} mode="any" />}
                        {pipelineName === 'transcriptome_pipeline_multi' && <DatasetsBuilder form={globalForm} mode="geoOnly" />}
                      </Form>
                    )}
                  </>
                )}
              </Card>

              <div style={{ height: 12 }} />

              <Card size="small" title={selectedStep ? `步骤参数：${selectedStep.step_id}` : '步骤参数'}>
                {!selectedStep ? (
                  <div className={styles.hint}>请点击左侧流程图节点</div>
                ) : !selectedStep.config_key ? (
                  <div className={styles.hint}>该步骤未定义 config_key，暂不支持参数覆盖</div>
                ) : selectedStepParams.length === 0 ? (
                  <div className={styles.hint}>该步骤暂无可覆盖参数（或尚未加载参数定义）</div>
                ) : (
                  <>
                    {(pipelineName === 'transcriptome_pipeline_multi' && selectedStep.step_id === '01_geo_annotation') ||
                    (pipelineName === 'transcriptome_pipeline_multi_any' && selectedStep.step_id === '01_input_prepare') ? (
                      <div className={styles.hint} style={{ marginBottom: 8 }}>
                        本步输入来自上方「datasets」中每个数据集的 probe_file、ann_file 等；此处仅可覆盖 out_dir、prefix、overwrite 等。
                      </div>
                    ) : null}
                    <div style={{ marginBottom: 8 }}>
                      <Text type="secondary">{selectedStep.name}</Text>
                    </div>
                    <ParameterForm
                      key={selectedStep.config_key}
                      parameters={selectedStepParams}
                      value={stepOverrides[selectedStep.config_key] || {}}
                      onChange={(next) => {
                        setStepOverrides((prev) => ({ ...prev, [selectedStep.config_key as string]: next }))
                      }}
                    />
                  </>
                )}
              </Card>

              {interpretation?.zhPath ? (
                <>
                  <div style={{ height: 12 }} />
                  <Card size="small" title="结果解读（中英草稿）">
                    <Text type="secondary" style={{ display: 'block', marginBottom: 10 }}>
                      由 OmicsFlowCore R 包在输出目录 <code>_pipeline/</code> 下自动生成；点击「文档视图」以纸张式阅读，便于对照修改后写入论文。
                    </Text>
                    <Space wrap>
                      <Button type="primary" onClick={() => setInterpretModalOpen(true)}>
                        文档视图
                      </Button>
                      <Button
                        size="small"
                        onClick={async () => {
                          if (!interpretation.zhPath) return
                          const r = await window.electronAPI.showItemInFolder(interpretation.zhPath)
                          if (!r.success) message.warning(r.error || '无法打开文件夹')
                        }}
                      >
                        在文件夹中显示
                      </Button>
                    </Space>
                  </Card>

                  <InterpretationDocModal
                    open={interpretModalOpen}
                    onClose={() => setInterpretModalOpen(false)}
                    title="结果解读（文档视图）"
                    zhContent={interpretation.zh || ''}
                    enContent={interpretation.en || ''}
                    showNotes={false}
                    onShowInFolder={async () => {
                      if (!interpretation?.zhPath) return
                      const r = await window.electronAPI.showItemInFolder(interpretation.zhPath)
                      if (!r.success) message.warning(r.error || '无法打开文件夹')
                    }}
                  />
                </>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                borderRight: '1px solid #f0f0f0',
              }}
            >
              {loading ? (
                <div style={{ padding: 24 }}>
                  <Spin />
                </div>
              ) : (
                <PipelineComposerCanvas
                  modules={composerModules}
                  paletteCollapsed={composerLeftCollapsed}
                  checkConnection={checkComposerConnection}
                  disabled={running}
                  rfRef={composerRfRef}
                  nodes={compNodes}
                  edges={compEdges}
                  onNodesChange={onCompNodesChange}
                  onEdgesChange={onCompEdgesChange}
                  setNodes={setCompNodes}
                  setEdges={setCompEdges}
                  selectedId={composerSelectedId}
                  onSelect={setComposerSelectedId}
                />
              )}
            </div>

            {!composerRightCollapsed ? (
            <div className={styles.panel}>
              <Card size="small" title="接续建议">
                {!selectedComposerModule ? (
                  <div className={styles.hint}>点击画布上的模块查看「建议下一步」；系统会根据常见分析链推荐候选模块。</div>
                ) : recommendNextModules.length === 0 ? (
                  <div className={styles.hint}>当前模块暂无内置推荐（可按你的目的自由拼接）。</div>
                ) : (
                  <div>
                    <Text>在「{selectedComposerModule.title}」之后，通常可接续：</Text>
                    {recommendNextModules.map((m) => (
                      <div
                        key={m.key}
                        style={{
                          marginTop: 8,
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text strong>{m.title}</Text>
                          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                            {m.functionName}
                          </Text>
                        </div>
                        <Button
                          type="link"
                          size="small"
                          style={{ flexShrink: 0, padding: '0 4px' }}
                          onClick={() => handleAddRecommendedModule(m)}
                        >
                          添加并连线
                        </Button>
                      </div>
                    ))}
                    <div className={styles.hint} style={{ marginTop: 8 }}>
                      也可点击「添加并连线」自动加入画布并接上当前模块；或从左侧拖入后手动连线。
                    </div>
                  </div>
                )}
              </Card>

              <div style={{ height: 12 }} />

              <Card size="small" title={selectedComposerNode ? `模块参数：${selectedComposerNode.data.title}` : '模块参数'}>
                {!selectedComposerNode || !selectedComposerModule ? (
                  <div className={styles.hint}>请点击画布上的一个模块以编辑该步 R 函数参数（会与上方全局参数合并后调用）。</div>
                ) : composerStepParams.length === 0 ? (
                  <div className={styles.hint}>正在加载 {selectedComposerModule.functionName} 的参数定义…</div>
                ) : (
                  <>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                      {selectedComposerModule.title}（{selectedComposerModule.functionName}）
                    </Text>
                    <ParameterForm
                      key={selectedComposerNode.id}
                      parameters={composerStepParams}
                      value={selectedComposerNode.data.params}
                      onChange={(next) => {
                        setCompNodes((ns) =>
                          ns.map((n) =>
                            n.id === selectedComposerNode.id ? { ...n, data: { ...n.data, params: next } } : n
                          )
                        )
                      }}
                    />
                  </>
                )}
              </Card>
            </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

