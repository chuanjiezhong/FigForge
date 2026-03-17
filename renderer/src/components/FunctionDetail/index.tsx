import { useState, useEffect, useCallback } from 'react'
import { Card, Button, Form, Input, message, Space, Typography, Divider, Tag, Select, Switch, InputNumber, ColorPicker, Tooltip } from 'antd'
import { UploadOutlined, PlayCircleOutlined, FileTextOutlined, FolderOutlined } from '@ant-design/icons'
import type { RFunctionInfo, ParameterInfo, ParameterType } from '../../types/pipeline'
import styles from './index.module.less'

const { Title, Text } = Typography
const { TextArea } = Input
const { Option } = Select

const TAG_COLOR_PALETTE = [
  'blue',
  'green',
  'orange',
  'purple',
  'cyan',
  'red',
  'gold',
  'lime',
  'magenta',
  'volcano',
  'geekblue',
]

function getTagColorForValue(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % TAG_COLOR_PALETTE.length
  return TAG_COLOR_PALETTE[index]
}

const COLOR_NAMES: Record<string, string> = {
  blue: '#0000FF',
  white: '#FFFFFF',
  red: '#FF0000',
  black: '#000000',
  green: '#008000',
  yellow: '#FFFF00',
  orange: '#FFA500',
}

/** 将 rgb/rgba 字符串转为 #RRGGBB，避免 ColorPicker 解析异常 */
function cssColorToHex(css: string): string {
  if (css.startsWith('#')) return css
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) {
    const r = Number(m[1]).toString(16).padStart(2, '0')
    const g = Number(m[2]).toString(16).padStart(2, '0')
    const b = Number(m[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return css
}

function parseColorGradient(value: string | undefined): string[] {
  if (!value || typeof value !== 'string') return ['#0000FF', '#FFFFFF', '#FF0000']
  const parts = value.split(',').map((s) => s.trim())
  return parts
    .map((p) => (p.startsWith('#') ? p : COLOR_NAMES[p.toLowerCase()] || p))
    .map(cssColorToHex)
    .slice(0, 5)
}

/** 生信高分文章常用热图渐变（快捷一键应用）；value 为逗号分隔 hex */
const PALETTE_GRADIENT_PRESETS: { label: string; value: string; colors: [string, string, string] }[] = [
  { label: '蓝-白-红 (RdBu)', value: '#2166ac,#f7f7f7,#b2182b', colors: ['#2166ac', '#f7f7f7', '#b2182b'] },
  { label: '蓝-黄-红 (经典)', value: '#3182bd,#ffffcc,#d73027', colors: ['#3182bd', '#ffffcc', '#d73027'] },
  { label: 'Nature 风格', value: '#0072B2,#f0f0f0,#D55E00', colors: ['#0072B2', '#f0f0f0', '#D55E00'] },
  { label: '绿-白-红', value: '#006837,#ffffbf,#a50026', colors: ['#006837', '#ffffbf', '#a50026'] },
  { label: '红-黄-蓝 (RdYlBu)', value: '#d73027,#ffffbf,#4575b4', colors: ['#d73027', '#ffffbf', '#4575b4'] },
  { label: 'Viridis 风格', value: '#440154,#21918c,#fde725', colors: ['#440154', '#21918c', '#fde725'] },
  { label: 'Coolwarm', value: '#3b4cc0,#f5f5f5,#b40426', colors: ['#3b4cc0', '#f5f5f5', '#b40426'] },
  { label: '蓝-白-红 (简)', value: 'blue,white,red', colors: ['#0000FF', '#FFFFFF', '#FF0000'] },
]

/** 色1（低值）常用色 */
const PALETTE_LOW_COLORS = ['#2166ac', '#3182bd', '#0072B2', '#440154', '#3b4cc0', '#0000FF', '#006837', '#4575b4', '#000000']
/** 色2（中值）常用色 */
const PALETTE_MID_COLORS = ['#f7f7f7', '#ffffcc', '#f0f0f0', '#FFFFFF', '#ffffbf', '#f5f5f5', '#e0e0e0', '#21918c', '#cccccc']
/** 色3（高值）常用色 */
const PALETTE_HIGH_COLORS = ['#b2182b', '#d73027', '#D55E00', '#FF0000', '#a50026', '#b40426', '#fde725', '#E69F00', '#009E73']

const PALETTE_SINGLE_CHIP_SIZE = 36
const PALETTE_BAR_WIDTH = 88
const PALETTE_BAR_HEIGHT = 32

/** 悬停时只显示大色块，不显示十六进制 */
function ColorPreviewTooltip({ hex, children }: { hex: string; children: React.ReactNode }) {
  return (
    <Tooltip
      title={
        <span
          style={{
            display: 'inline-block',
            width: 56,
            height: 56,
            backgroundColor: hex,
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        />
      }
    >
      {children}
    </Tooltip>
  )
}

/** 悬停时显示渐变条预览（预设名称 + 色条），不显示十六进制 */
function GradientPreviewTooltip({ label, colors, children }: { label: string; colors: [string, string, string]; children: React.ReactNode }) {
  return (
    <Tooltip
      title={
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#fff' }}>{label}</span>
          <span
            style={{
              display: 'inline-block',
              width: 80,
              height: 28,
              borderRadius: 6,
              background: `linear-gradient(to right, ${colors[0]}, ${colors[1]}, ${colors[2]})`,
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            }}
          />
        </span>
      }
    >
      {children}
    </Tooltip>
  )
}

function ColorGradientInput({
  value,
  onChange,
  count = 3,
}: {
  value?: string
  onChange?: (next: string) => void
  count?: number
}) {
  const colors = parseColorGradient(value)
  const list = Array.from({ length: count }, (_, i) => colors[i] || '#cccccc')
  const currentValue = value?.trim() || ''

  const handleChange = (index: number, hex: string) => {
    const next = [...list]
    next[index] = hex
    onChange?.(next.join(','))
  }

  const presetRows = [
    { label: '色1（低）', colors: PALETTE_LOW_COLORS, index: 0 },
    { label: '色2（中）', colors: PALETTE_MID_COLORS, index: 1 },
    { label: '色3（高）', colors: PALETTE_HIGH_COLORS, index: 2 },
  ]

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>快捷渐变（点击整条应用）</Text>
        <Space wrap size={8}>
          {PALETTE_GRADIENT_PRESETS.map((preset) => {
            const normalizedCurrent = currentValue.split(',').map((s) => s.trim().toLowerCase()).join(',')
            const normalizedPreset = preset.value.split(',').map((s) => s.trim().toLowerCase()).join(',')
            const match = normalizedCurrent === normalizedPreset
            return (
              <GradientPreviewTooltip key={preset.value} label={preset.label} colors={preset.colors}>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => onChange?.(preset.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onChange?.(preset.value)}
                  style={{
                    width: PALETTE_BAR_WIDTH,
                    height: PALETTE_BAR_HEIGHT,
                    borderRadius: 6,
                    background: `linear-gradient(to right, ${preset.colors[0]}, ${preset.colors[1]}, ${preset.colors[2]})`,
                    border: match ? '2px solid #1890ff' : '1px solid #d9d9d9',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
              </GradientPreviewTooltip>
            )
          })}
        </Space>
      </div>
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>每色单独选（悬停可看颜色）</Text>
        {presetRows.map(({ label, colors: presetColors, index }) => {
          const currentHex = (list[index] || '#cccccc').toLowerCase()
          return (
            <Space key={index} align="center" wrap size={6} style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#666', minWidth: 56 }}>{label}</span>
              {presetColors.map((hex) => (
                <ColorPreviewTooltip key={hex} hex={hex}>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => handleChange(index, hex)}
                    onKeyDown={(e) => e.key === 'Enter' && handleChange(index, hex)}
                    style={{
                      width: PALETTE_SINGLE_CHIP_SIZE,
                      height: PALETTE_SINGLE_CHIP_SIZE,
                      borderRadius: 6,
                      backgroundColor: hex,
                      border: currentHex === hex.toLowerCase() ? '2px solid #1890ff' : '1px solid #d9d9d9',
                      cursor: 'pointer',
                    }}
                  />
                </ColorPreviewTooltip>
              ))}
              <ColorPicker
                value={list[index] || '#cccccc'}
                onChange={(color) => {
                  const hexStr = color?.toHexString?.() ?? list[index] ?? '#cccccc'
                  handleChange(index, hexStr)
                }}
                showText
                size="middle"
                getPopupContainer={() => document.body}
              />
            </Space>
          )
        })}
      </div>
    </Space>
  )
}

/** 注释列颜色：Group（来自 contrast，每组一色）+ DataSet（来自 annotation_dataset_levels，每个样本名一色）；value 为 { group?, dataset? } */
type AnnotationColorsValue = { group?: Record<string, string>; dataset?: Record<string, string> }

const ANNOTATION_COLORS_EMPTY: AnnotationColorsValue = { group: {}, dataset: {} }

/** 注释列内置可选颜色（生信常用/色盲友好，用于预设色块 + 未指定时传给 R 的默认色） */
const ANNOTATION_PRESET_COLORS = [
  '#0072B2', '#D55E00', '#009E73', '#F0E442', '#56B4E9', '#E69F00', '#CC79A7', '#000000', '#999999',
]
const ANNOTATION_CHIP_SIZE = 36

function getDefaultAnnotationColor(index: number): string {
  return ANNOTATION_PRESET_COLORS[index % ANNOTATION_PRESET_COLORS.length]
}

function normalizeAnnotationValue(value: unknown): AnnotationColorsValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ANNOTATION_COLORS_EMPTY
  const v = value as Record<string, unknown>
  if (v.group && typeof v.group === 'object' && !Array.isArray(v.group)) {
    const group = v.group as Record<string, string>
    const dataset = v.dataset && typeof v.dataset === 'object' && !Array.isArray(v.dataset) ? (v.dataset as Record<string, string>) : {}
    return { group, dataset }
  }
  // 兼容旧版：扁平 Record 视为仅 Group
  const flat = v as Record<string, string>
  const hasGroupKey = Object.keys(flat).some((k) => k !== 'group' && k !== 'dataset')
  if (hasGroupKey) return { group: flat, dataset: {} }
  return ANNOTATION_COLORS_EMPTY
}

function AnnotationColorsInput({ value, onChange, contrastFieldName = 'contrast', datasetLevelsFieldName = 'annotation_dataset_levels' }: {
  value?: AnnotationColorsValue | Record<string, string>
  onChange?: (next: AnnotationColorsValue) => void
  contrastFieldName?: string
  datasetLevelsFieldName?: string
}) {
  const form = Form.useFormInstance()
  const contrast = Form.useWatch(contrastFieldName, form) as string[] | undefined
  const datasetLevels = Form.useWatch(datasetLevelsFieldName, form) as string[] | undefined
  const { group: groupRecord = {}, dataset: datasetRecord = {} } = normalizeAnnotationValue(value)
  const groups = Array.isArray(contrast) ? contrast.slice(0, 2).filter(Boolean) : []
  const sampleNames = Array.isArray(datasetLevels) ? datasetLevels.filter(Boolean) : []

  const updateGroup = (name: string, hex: string) => {
    onChange?.({ ...normalizeAnnotationValue(value), group: { ...groupRecord, [name]: hex } })
  }
  const updateDataset = (name: string, hex: string) => {
    const base = normalizeAnnotationValue(value)
    onChange?.({ group: base.group ?? {}, dataset: { ...(base.dataset ?? {}), [name]: hex } })
  }

  const renderColorRow = (label: string, currentHex: string, onPick: (hex: string) => void) => (
    <Space align="center" wrap style={{ marginTop: 6 }}>
      <span style={{ fontSize: 12, color: '#666', minWidth: 72 }}>{label}</span>
      <Space size={6}>
        {ANNOTATION_PRESET_COLORS.map((hex) => (
          <ColorPreviewTooltip key={hex} hex={hex}>
            <span
              role="button"
              tabIndex={0}
              onClick={() => onPick(hex)}
              onKeyDown={(e) => e.key === 'Enter' && onPick(hex)}
              style={{
                width: ANNOTATION_CHIP_SIZE,
                height: ANNOTATION_CHIP_SIZE,
                borderRadius: 6,
                backgroundColor: hex,
                border: currentHex.toLowerCase() === hex.toLowerCase() ? '2px solid #1890ff' : '1px solid #d9d9d9',
                cursor: 'pointer',
              }}
            />
          </ColorPreviewTooltip>
        ))}
      </Space>
      <ColorPicker
        value={currentHex}
        onChange={(color) => {
          const hexStr = color?.toHexString?.() ?? currentHex
          onPick(hexStr)
        }}
        showText
        size="middle"
        getPopupContainer={() => document.body}
      />
    </Space>
  )

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>Group（点击色块或取色器）</Text>
        {groups.length === 0 ? (
          <div><Text type="secondary">请先在上方「contrast」中选择两组</Text></div>
        ) : (
          groups.map((group, i) =>
            renderColorRow(
              group,
              groupRecord[group] || getDefaultAnnotationColor(i),
              (hex) => updateGroup(group, hex)
            )
          )
        )}
      </div>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>DataSet（点击色块或取色器）</Text>
        {sampleNames.length === 0 ? (
          <div style={{ marginTop: 4 }}><Text type="secondary">在上方「annotation_dataset_levels」中填写样本名称后，此处可为每个样本设置颜色</Text></div>
        ) : (
          sampleNames.map((name, i) =>
            renderColorRow(
              name,
              datasetRecord[name] || getDefaultAnnotationColor(i),
              (hex) => updateDataset(name, hex)
            )
          )
        )}
      </div>
    </Space>
  )
}

/** PCA 等使用的分组配色：分组标签 + 颜色，内部存储为 { groupName: hex } */
function GroupColorsInput({ value, onChange }: { value?: Record<string, string>; onChange?: (next: Record<string, string>) => void }) {
  const map: Record<string, string> = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const entries = Object.entries(map)

  const updateColor = (name: string, hex: string) => {
    onChange?.({ ...map, [name]: hex })
  }

  const renameGroup = (oldName: string, newNameRaw: string) => {
    const newName = newNameRaw.trim()
    if (!newName || newName === oldName) return
    if (map[newName]) return
    const next: Record<string, string> = {}
    Object.entries(map).forEach(([k, v]) => {
      if (k === oldName) {
        next[newName] = v
      } else {
        next[k] = v
      }
    })
    onChange?.(next)
  }

  const removeGroup = (name: string) => {
    const next: Record<string, string> = {}
    Object.entries(map).forEach(([k, v]) => {
      if (k !== name) next[k] = v
    })
    onChange?.(next)
  }

  const addGroup = () => {
    let index = entries.length + 1
    let name = `Group${index}`
    while (map[name]) {
      index += 1
      name = `Group${index}`
    }
    const color = getDefaultAnnotationColor(entries.length)
    onChange?.({ ...map, [name]: color })
  }

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        分组颜色（默认生成 Group1/Group2，可修改名称，再点击色块或取色器调整）
      </Text>
      {entries.map(([name, hex], i) => (
        <Space key={name} align="center" wrap style={{ marginTop: 6 }}>
          <Input
            size="small"
            style={{ width: 140 }}
            defaultValue={name}
            onBlur={(e) => renameGroup(name, e.target.value)}
          />
          <Space size={6}>
            {ANNOTATION_PRESET_COLORS.map((preset) => (
              <ColorPreviewTooltip key={preset} hex={preset}>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => updateColor(name, preset)}
                  onKeyDown={(e) => e.key === 'Enter' && updateColor(name, preset)}
                  style={{
                    width: ANNOTATION_CHIP_SIZE,
                    height: ANNOTATION_CHIP_SIZE,
                    borderRadius: 6,
                    backgroundColor: preset,
                    border: hex.toLowerCase() === preset.toLowerCase() ? '2px solid #1890ff' : '1px solid #d9d9d9',
                    cursor: 'pointer',
                  }}
                />
              </ColorPreviewTooltip>
            ))}
          </Space>
          <ColorPicker
            value={hex || getDefaultAnnotationColor(i)}
            onChange={(color) => {
              const hexStr = color?.toHexString?.() ?? hex ?? getDefaultAnnotationColor(i)
              updateColor(name, hexStr)
            }}
            showText
            size="middle"
            getPopupContainer={() => document.body}
          />
          <Button size="small" onClick={() => removeGroup(name)}>
            删除
          </Button>
        </Space>
      ))}
      <Button size="small" type="dashed" onClick={addGroup}>
        添加分组
      </Button>
    </Space>
  )
}

/** tags 类型 Select，可选 maxItems 限制（如 contrast 最多 2 组） */
function TagsSelectInput({
  value,
  onChange,
  maxItems,
  placeholder,
  options,
}: {
  value?: string[]
  onChange?: (v: string[]) => void
  maxItems?: number
  placeholder: string
  options: { label: string; value: string }[]
}) {
  const limitedValue = maxItems != null && Array.isArray(value) && value.length > maxItems ? value.slice(0, maxItems) : value
  return (
    <Select
      mode="tags"
      placeholder={placeholder}
      options={options}
      tokenSeparators={[',']}
      style={{ width: '100%' }}
      value={limitedValue}
      onChange={(v) => {
        const next = Array.isArray(v) ? (maxItems != null ? v.slice(0, maxItems) : v) : []
        onChange?.(next)
      }}
      maxTagCount={maxItems ?? undefined}
      tagRender={({ value: tagVal, closable, onClose }) => (
        <Tag color={getTagColorForValue(String(tagVal))} closable={closable} onClose={onClose} style={{ marginRight: 4 }}>
          {tagVal}
        </Tag>
      )}
    />
  )
}

function FilePickerInput({
  value,
  onChange,
  placeholder,
}: {
  value?: string
  onChange?: (next?: string) => void
  placeholder: string
}) {
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input placeholder={placeholder} readOnly value={value} />
      <Button
        icon={<UploadOutlined />}
        onClick={async () => {
          try {
            const files = await window.electronAPI.selectFiles({
              filters: [{ name: 'All Files', extensions: ['*'] }],
            })
            if (files && files.length > 0) {
              onChange?.(files[0])
            }
          } catch (error) {
            console.error('Failed to select file:', error)
          }
        }}
      >
        选择文件
      </Button>
    </Space.Compact>
  )
}

function DirectoryPickerInput({
  value,
  onChange,
  placeholder,
}: {
  value?: string
  onChange?: (next?: string) => void
  placeholder: string
}) {
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input placeholder={placeholder} readOnly value={value} />
      <Button
        icon={<FolderOutlined />}
        onClick={async () => {
          try {
            const dir = await window.electronAPI.selectDirectory()
            if (dir) {
              onChange?.(dir)
            }
          } catch (error) {
            console.error('Failed to select directory:', error)
          }
        }}
      >
        选择目录
      </Button>
    </Space.Compact>
  )
}

/** 单色参数：颜色选择器，值为 hex（如 #D17C5B） */
function SingleColorInput({ value, onChange }: { value?: string; onChange?: (hex: string) => void }) {
  return (
    <ColorPicker
      value={value || '#000000'}
      onChange={(color) => {
        const hex = color?.toHexString?.()
        if (hex) onChange?.(hex)
      }}
      showText
      size="middle"
      getPopupContainer={() => document.body}
    />
  )
}

interface FunctionDetailProps {
  functionInfo: RFunctionInfo | null
  onRun: (params: Record<string, unknown>, inputFiles: string[]) => void
  loading?: boolean
  /** 分析完成后由父组件递增，用于自动清空表单 */
  formResetTrigger?: number
}

function FunctionDetail({ functionInfo, onRun, loading: _loading = false, formResetTrigger = 0 }: FunctionDetailProps) {
  const [form] = Form.useForm()
  const [documentation, setDocumentation] = useState<string>('')
  const [detailedParameters, setDetailedParameters] = useState<ParameterInfo[]>([])
  const [functionDescription, setFunctionDescription] = useState<string>('')
  const [examples, setExamples] = useState<string>('')

  const applyParamDefaults = useCallback((params: ParameterInfo[]) => {
    params.forEach((param) => {
      const current = form.getFieldValue(param.name)
      if (param.type === 'annotationColors') {
        const normalized = current && typeof current === 'object' && !Array.isArray(current) ? current : null
        if (!normalized || (!('group' in (normalized as any)) && !('dataset' in (normalized as any)))) {
          form.setFieldsValue({ [param.name]: { group: {}, dataset: {} } })
        }
        return
      }
      if (param.type === 'groupColors') {
        const isEmptyObj =
          current == null ||
          (typeof current === 'object' && !Array.isArray(current) && Object.keys(current as Record<string, unknown>).length === 0)
        if (isEmptyObj) {
          form.setFieldsValue({
            [param.name]: {
              Group1: getDefaultAnnotationColor(0),
              Group2: getDefaultAnnotationColor(1),
            },
          })
        }
        return
      }
      if (current === undefined && param.default !== undefined) {
        form.setFieldsValue({ [param.name]: param.default })
      }
    })
  }, [form])

  // 分析完成后自动清空参数表单
  useEffect(() => {
    if (formResetTrigger > 0) {
      form.resetFields()
      // resetFields 会把 groupColors 清空为 undefined/{}，这里补回默认值，保证“颜色可选且可还原”
      if (detailedParameters.length > 0) {
        applyParamDefaults(detailedParameters)
      }
    }
  }, [formResetTrigger, form, detailedParameters, applyParamDefaults])

  // 加载函数文档
  useEffect(() => {
    if (!functionInfo) {
      setDocumentation('')
      setDetailedParameters([])
      setFunctionDescription('')
      setExamples('')
      form.resetFields()
      return
    }

    // 重置为加载状态
    setDocumentation('')
    setDetailedParameters([])
    setFunctionDescription('')
    setExamples('')

    const loadDocumentation = async () => {
      try {
        const result = await window.electronAPI.getRFunctionDoc(
          functionInfo.name,
          functionInfo.package
        )
        if (result.success) {
          if (result.documentation && result.documentation.trim().length > 0) {
            setDocumentation(result.documentation.trim())
          } else {
            setDocumentation('暂无文档')
          }
          
          // 使用内置的详细参数信息
          if (result.detailedParameters && Array.isArray(result.detailedParameters)) {
            setDetailedParameters(result.detailedParameters as ParameterInfo[])
            applyParamDefaults(result.detailedParameters as ParameterInfo[])
          } else if (functionInfo.parameters) {
            // 如果没有详细参数，使用简单参数列表
            const simpleParams: ParameterInfo[] = functionInfo.parameters
              .filter((p) => typeof p === 'string' && !p.startsWith('input_'))
              .map((p) => ({
                name: p as string,
                type: 'string' as ParameterType,
                required: false,
              }))
            setDetailedParameters(simpleParams)
          }
          
          if (result.description) {
            setFunctionDescription(result.description)
          }
          if (result.examples) {
            setExamples(result.examples)
          }
        } else {
          setDocumentation('暂无文档')
        }
      } catch (error) {
        console.error('Failed to load documentation:', error)
        setDocumentation('加载文档失败')
      }
    }

    loadDocumentation()
  }, [functionInfo, form])

  // 运行函数（工具栏“运行分析”触发时调用）
  const handleRun = useCallback(() => {
    if (!functionInfo) return
    form.validateFields().then((values) => {
      const normalizedValues: Record<string, unknown> = { ...values }
      detailedParameters.forEach((p) => {
        const v = normalizedValues[p.name]
        if (v === undefined || v === null || v === '') {
          if (p.default !== undefined) normalizedValues[p.name] = p.default
          return
        }
        if (p.type === 'array') {
          if (typeof v === 'string') {
            const arr = v.split('\n').map((s) => s.trim()).filter(Boolean)
            normalizedValues[p.name] = arr
          }
        }
        if (p.type === 'tags') {
          if (typeof v === 'string') {
            normalizedValues[p.name] = v.split(',').map((s) => s.trim()).filter(Boolean)
          }
          // 已是 string[] 则直接传给 R（如 c("Control", "Disease")）
        }
        if (p.type === 'colorGradient') {
          if (typeof v === 'string') {
            normalizedValues[p.name] = v.split(',').map((s) => s.trim()).filter(Boolean)
          }
          // 转为数组后，后端 toRValue 会生成 palette = c("blue","white","red")
        }
        if (p.type === 'annotationColors') {
          const contrastArr = (normalizedValues['contrast'] as string[] | undefined) ?? []
          const datasetLevelsArr = (normalizedValues['annotation_dataset_levels'] as string[] | undefined) ?? []
          const groups = Array.isArray(contrastArr) ? contrastArr.slice(0, 2).filter(Boolean) : []
          const sampleNames = Array.isArray(datasetLevelsArr) ? datasetLevelsArr.filter(Boolean) : []
          const normalized = v && typeof v === 'object' && !Array.isArray(v) ? normalizeAnnotationValue(v) : ANNOTATION_COLORS_EMPTY
          const groupEntries: [string, string][] = groups.map((name, i) => [
            name,
            (normalized.group?.[name] && normalized.group[name].trim()) || getDefaultAnnotationColor(i),
          ])
          const datasetEntries: [string, string][] = sampleNames.map((name, i) => [
            name,
            (normalized.dataset?.[name] && normalized.dataset[name].trim()) || getDefaultAnnotationColor(i),
          ])
          const toRVec = (entries: [string, string][]) =>
            entries.map(([k, hex]) => `"${String(k).replace(/"/g, '\\"')}"="${hex}"`).join(', ')
          const parts: string[] = []
          if (groupEntries.length > 0) parts.push(`Group=c(${toRVec(groupEntries)})`)
          if (datasetEntries.length > 0) parts.push(`DataSet=c(${toRVec(datasetEntries)})`)
          normalizedValues[p.name] = parts.length > 0 ? `list(${parts.join(', ')})` : 'NULL'
        }
        if (p.type === 'select' && p.name === 'show_numbers') {
          if (v === 'true') normalizedValues[p.name] = true
          if (v === 'false') normalizedValues[p.name] = false
          if (v === 'auto') delete normalizedValues[p.name]
        }
      })
      onRun(normalizedValues, [])
    }).catch(() => {
      message.warning('请填写完整的参数')
    })
  }, [functionInfo, form, onRun, detailedParameters])

  // 监听工具栏的运行分析事件
  useEffect(() => {
    const handleTriggerRun = () => {
      if (!functionInfo) {
        message.warning('请先选择一个函数')
        return
      }
      handleRun()
    }
    window.addEventListener('trigger-run-analysis', handleTriggerRun)
    return () => {
      window.removeEventListener('trigger-run-analysis', handleTriggerRun)
    }
  }, [functionInfo, handleRun])

  // 渲染参数输入控件
  const renderParameterInput = (param: ParameterInfo) => {
    const placeholder = param.placeholder || `请输入 ${param.name}`

    switch (param.type) {
      case 'number':
        return (
          <InputNumber
            style={{ width: '100%' }}
            placeholder={placeholder}
            min={param.min}
            max={param.max}
          />
        )
      
      case 'boolean':
        return <Switch checkedChildren="是" unCheckedChildren="否" />
      
      case 'select':
        return (
          <Select placeholder={placeholder}>
            {param.options?.map((option) => (
              <Option key={option} value={option}>
                {option}
              </Option>
            ))}
          </Select>
        )

      case 'tags': {
        const maxItems = param.name === 'contrast' ? 2 : undefined
        return (
          <TagsSelectInput
            placeholder={placeholder}
            options={(param.options || []).map((opt) => ({ label: opt, value: opt }))}
            maxItems={maxItems}
          />
        )
      }

      case 'file':
        return <FilePickerInput placeholder={placeholder} />
      
      case 'directory':
        return <DirectoryPickerInput placeholder={placeholder} />
      
      case 'text':
        return <TextArea rows={4} placeholder={placeholder} />
      
      case 'array':
        return (
          <TextArea
            rows={3}
            placeholder={`请输入数组，每行一个元素\n${placeholder}`}
          />
        )

      case 'color':
        return <SingleColorInput />

      case 'colorGradient':
        return <ColorGradientInput count={3} />

      case 'groupColors':
        return <GroupColorsInput />

      case 'annotationColors':
        return <AnnotationColorsInput contrastFieldName="contrast" />

      case 'string':
      default:
        return <Input placeholder={placeholder} />
    }
  }

  if (!functionInfo) {
    return (
      <div className={styles.empty}>
        <FileTextOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
        <p>请从左侧选择一个函数查看详情</p>
      </div>
    )
  }

  return (
    <div className={styles.functionDetail}>
      <Card>
        <Title level={4}>
          <PlayCircleOutlined /> {functionInfo.name}
        </Title>
        {functionInfo.package && (
          <Tag color="blue" style={{ marginBottom: 16 }}>
            {functionInfo.package}
          </Tag>
        )}

        <Divider />

        {/* 函数描述 */}
        {functionDescription && (
          <>
            <div className={styles.section}>
              <Title level={5}>函数描述</Title>
              <Text>{functionDescription}</Text>
            </div>
            <Divider />
          </>
        )}

        {/* 函数文档 */}
        <div className={styles.section}>
          <Title level={5}>函数文档</Title>
          <div className={styles.documentation}>
            {documentation === '' ? (
              <Text type="secondary">加载中...</Text>
            ) : documentation === '暂无文档' || documentation === '加载文档失败' ? (
              <Text type="secondary">{documentation}</Text>
            ) : (
              <pre>{documentation}</pre>
            )}
          </div>
        </div>

        {/* 使用示例 */}
        {examples && (
          <>
            <Divider />
            <div className={styles.section}>
              <Title level={5}>使用示例</Title>
              <pre className={styles.codeExample}>{examples}</pre>
            </div>
          </>
        )}

        <Divider />

        {/* 参数配置 */}
        <div className={styles.section}>
          <Title level={5}>参数配置</Title>
          <Form form={form} layout="vertical">
            {/* 使用详细参数配置 */}
            {detailedParameters.length > 0 ? (
              detailedParameters.map((param) => (
                <Form.Item
                  key={param.name}
                  name={param.name}
                  label={
                    <Space>
                      {param.name}
                      {(param.required || param.name === 'annotation_dataset_levels') && <Text type="danger">*</Text>}
                    </Space>
                  }
                  tooltip={param.description}
                  rules={[
                    ...(param.required ? [{ required: true, message: `请输入${param.name}` }] : []),
                    ...(param.name === 'contrast'
                    ? [
                        {
                          validator: (_: unknown, val: unknown) => {
                            const arr = Array.isArray(val) ? val : []
                            if (arr.length === 0) return Promise.reject(new Error('请选择两组'))
                            if (arr.length === 1) return Promise.reject(new Error('请选择两组（当前只选了一组）'))
                            if (arr.length > 2) return Promise.reject(new Error('最多选择两组'))
                            return Promise.resolve()
                          },
                        },
                      ]
                    : []),
                    ...(param.name === 'annotation_dataset_levels'
                    ? [
                        {
                          validator: (_: unknown, val: unknown) => {
                            if (Array.isArray(val)) {
                              if (val.length === 0) return Promise.reject(new Error('请至少填写一个样本名称'))
                              return Promise.resolve()
                            }
                            const text = typeof val === 'string' ? val.trim() : ''
                            if (!text) return Promise.reject(new Error('请至少填写一个样本名称'))
                            return Promise.resolve()
                          },
                        },
                      ]
                    : []),
                  ]}
                  initialValue={param.type === 'annotationColors' ? { group: {}, dataset: {} } : param.default}
                  valuePropName={param.type === 'boolean' ? 'checked' : 'value'}
                >
                  {renderParameterInput(param)}
                </Form.Item>
              ))
            ) : (
              // 如果没有详细参数，使用简单参数列表（向后兼容）
              functionInfo.parameters &&
              Array.isArray(functionInfo.parameters) &&
              functionInfo.parameters.length > 0 && (
                <>
                  {functionInfo.parameters
                    .filter((param) => typeof param === 'string' && !param.startsWith('input_'))
                    .map((param) => (
                      <Form.Item
                        key={param}
                        name={param}
                        label={param}
                        tooltip={`函数参数: ${param}`}
                      >
                        <Input placeholder={`请输入 ${param}`} />
                      </Form.Item>
                    ))}
                </>
              )
            )}
          </Form>
        </div>
      </Card>
    </div>
  )
}

export default FunctionDetail

