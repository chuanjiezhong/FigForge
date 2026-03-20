import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Form, Input, message, Select, Space, Spin, Typography } from 'antd'
import ReactFlow, { Background, Controls, type Edge, type Node, type ReactFlowInstance } from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import type { ParameterInfo } from '../../types/pipeline'
import { ParameterForm, type ParameterFormValue } from '../SharedParameterForm'
import styles from './index.module.less'

const { Text } = Typography

type PipelineStepDef = {
  step_id: string
  name: string
  config_key?: string
  fn?: string | string[]
  overridable_params?: string[]
  outputs_keys?: string[]
}

type PipelineDefs = Record<string, { pipeline_name: string; steps: PipelineStepDef[] }>

const UNICODE_TOKEN_RE = /<U\+([0-9A-Fa-f]{4,6})>/g
function decodeUnicodeTokensInString(input: string): string {
  if (!input.includes('<U+')) return input
  return input.replace(UNICODE_TOKEN_RE, (_, hex: string) => {
    const codePoint = Number.parseInt(hex, 16)
    if (!Number.isFinite(codePoint)) return _
    return String.fromCodePoint(codePoint)
  })
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

function asArray(x: string | string[] | undefined): string[] {
  if (!x) return []
  return Array.isArray(x) ? x : [x]
}

function firstFn(step: PipelineStepDef): string | null {
  const fns = asArray(step.fn)
  return fns.length ? fns[0] : null
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
          ? '当前流程仅支持 GEO 数据集：每个数据集需要 probe_file、ann_file、group_file。'
          : '支持混合输入：count 会先转换 TPM（如提供 annot_file 会先做 GeneID->Symbol）；tpm/expr 先读取表达矩阵（如提供 annot_file 也会把行名当作 GeneID->Symbol 转换）；geo 先注释生成表达矩阵。每个数据集都需要 group_file。'}
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
                        <DatasetFilePicker placeholder="注释文件 ann.txt" />
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
  const [statusDir, setStatusDir] = useState<string | null>(null)
  const [stepStatusMap, setStepStatusMap] = useState<Record<string, StepStatus>>({})
  const pollingRef = useRef<number | null>(null)
  const rfRef = useRef<ReactFlowInstance | null>(null)

  const steps = defs?.[pipelineName]?.steps ?? []
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
  }, [pipelineName, steps.length])

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

  const handleRun = async () => {
    try {
      if (running) return
      const globalValues = await globalForm.validateFields()
      if (pipelineName === 'transcriptome_pipeline_multi_any' || pipelineName === 'transcriptome_pipeline_multi') {
        const ds = (globalValues as any)?.datasets as DatasetItem[] | undefined
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
      setStatusDir(statusDirPath)

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
        if (result.success && result.outputDir) {
          message.success(`Pipeline 运行完成：${baseOut}`)
        } else {
          const err = result.error || '脚本执行失败'
          if (err !== '分析已取消') message.error(err)
          else message.info('分析已取消')
        }
      })

      const run = await window.electronAPI.runRScript(gen.outputDir, gen.script)
      if (!run.started) {
        cleanup?.()
        setRunning(false)
        message.error(run.error || '启动失败')
      }
    } catch (e) {
      // 表单校验失败不提示
      if (e && typeof e === 'object' && 'errorFields' in (e as any)) return
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
        <Select
          style={{ width: 360 }}
          loading={loading}
          value={pipelineName}
          options={pipelineOptions}
          onChange={(v) => setPipelineName(v)}
          disabled={running}
        />
        <Button type="primary" onClick={handleRun} disabled={loading || !defs || running}>
          {running ? '运行中…' : '运行 Pipeline'}
        </Button>
        <Button onClick={handleCancel} disabled={!running}>
          取消
        </Button>
        {running && runOutputDir && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            输出：{runOutputDir}
          </Text>
        )}
      </div>

      <div className={styles.main}>
        <div className={styles.graph}>
          {loading ? (
            <div style={{ padding: 24 }}><Spin /></div>
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

          <Card
            size="small"
            title={selectedStep ? `步骤参数：${selectedStep.step_id}` : '步骤参数'}
          >
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
        </div>
      </div>
    </div>
  )
}

