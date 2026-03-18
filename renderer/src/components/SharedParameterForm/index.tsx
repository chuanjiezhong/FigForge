import { Button, ColorPicker, Form, Input, InputNumber, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd'
import { UploadOutlined, FolderOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import type { ParameterInfo, ParameterType } from '../../types/pipeline'

const { Text } = Typography
const { TextArea } = Input

const TAG_COLOR_PALETTE = ['blue', 'green', 'orange', 'purple', 'cyan', 'red', 'gold', 'lime', 'magenta', 'volcano', 'geekblue']

function getTagColorForValue(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % TAG_COLOR_PALETTE.length
  return TAG_COLOR_PALETTE[index]
}

function FilePickerInput({ value, onChange, placeholder }: { value?: string; onChange?: (v?: string) => void; placeholder: string }) {
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input placeholder={placeholder} readOnly value={value} />
      <Button
        icon={<UploadOutlined />}
        onClick={async () => {
          const files = await window.electronAPI.selectFiles({ filters: [{ name: 'All Files', extensions: ['*'] }] })
          if (files && files.length > 0) onChange?.(files[0])
        }}
      >
        选择文件
      </Button>
    </Space.Compact>
  )
}

function DirectoryPickerInput({ value, onChange, placeholder }: { value?: string; onChange?: (v?: string) => void; placeholder: string }) {
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input placeholder={placeholder} readOnly value={value} />
      <Button
        icon={<FolderOutlined />}
        onClick={async () => {
          const dir = await window.electronAPI.selectDirectory()
          if (dir) onChange?.(dir)
        }}
      >
        选择目录
      </Button>
    </Space.Compact>
  )
}

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

const COLOR_NAMES: Record<string, string> = { blue: '#0000FF', white: '#FFFFFF', red: '#FF0000', black: '#000000', green: '#008000', yellow: '#FFFF00', orange: '#FFA500' }

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
  return parts.map((p) => (p.startsWith('#') ? p : COLOR_NAMES[p.toLowerCase()] || p)).map(cssColorToHex).slice(0, 5)
}

function ColorGradientInput({ value, onChange, count = 3 }: { value?: string; onChange?: (next: string) => void; count?: number }) {
  const colors = parseColorGradient(value)
  const list = Array.from({ length: count }, (_, i) => colors[i] || '#cccccc')
  const handleChange = (index: number, hex: string) => {
    const next = [...list]
    next[index] = hex
    onChange?.(next.join(','))
  }
  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      {list.map((hex, i) => (
        <Space key={i} align="center">
          <Text type="secondary" style={{ fontSize: 12, width: 40 }}>色{i + 1}</Text>
          <ColorPicker
            value={hex}
            onChange={(color) => {
              const hexStr = color?.toHexString?.() ?? hex
              handleChange(i, hexStr)
            }}
            showText
            size="middle"
            getPopupContainer={() => document.body}
          />
        </Space>
      ))}
    </Space>
  )
}

function TagsSelectInput({ value, onChange, maxItems, placeholder, options }: { value?: string[]; onChange?: (v: string[]) => void; maxItems?: number; placeholder: string; options: { label: string; value: string }[] }) {
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

function ColorPreviewTooltip({ hex, children }: { hex: string; children: React.ReactNode }) {
  return (
    <Tooltip
      title={<span style={{ display: 'inline-block', width: 56, height: 56, backgroundColor: hex, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }} />}
    >
      {children}
    </Tooltip>
  )
}

const ANNOTATION_PRESET_COLORS = ['#0072B2', '#D55E00', '#009E73', '#F0E442', '#56B4E9', '#E69F00', '#CC79A7', '#000000', '#999999']
const ANNOTATION_CHIP_SIZE = 30
function getDefaultAnnotationColor(index: number): string {
  return ANNOTATION_PRESET_COLORS[index % ANNOTATION_PRESET_COLORS.length]
}

export type ParameterFormValue = Record<string, unknown>

function GroupColorsInput({ value, onChange }: { value?: Record<string, string>; onChange?: (next: Record<string, string>) => void }) {
  const map: Record<string, string> = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {}
  const entries = Object.entries(map)

  const updateColor = (name: string, hex: string) => onChange?.({ ...map, [name]: hex })

  const renameGroup = (oldName: string, newNameRaw: string) => {
    const newName = newNameRaw.trim()
    if (!newName || newName === oldName) return
    if (map[newName]) return
    const next: Record<string, string> = {}
    Object.entries(map).forEach(([k, v]) => {
      if (k === oldName) next[newName] = v
      else next[k] = v
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
    onChange?.({ ...map, [name]: getDefaultAnnotationColor(entries.length) })
  }

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>分组颜色（可添加/改名/选色）</Text>
      {entries.map(([name, hex], i) => (
        <Space key={name} align="center" wrap>
          <Input size="small" style={{ width: 140 }} defaultValue={name} onBlur={(e) => renameGroup(name, e.target.value)} />
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
                    border: (hex || getDefaultAnnotationColor(i)).toLowerCase() === preset.toLowerCase() ? '2px solid #1677ff' : '1px solid #d9d9d9',
                    cursor: 'pointer',
                  }}
                />
              </ColorPreviewTooltip>
            ))}
          </Space>
          <ColorPicker
            value={(hex || getDefaultAnnotationColor(i)) as string}
            onChange={(color) => updateColor(name, color?.toHexString?.() ?? hex ?? getDefaultAnnotationColor(i))}
            showText
            size="middle"
            getPopupContainer={() => document.body}
          />
          <Button size="small" onClick={() => removeGroup(name)}>删除</Button>
        </Space>
      ))}
      <Button size="small" type="dashed" onClick={addGroup}>添加分组</Button>
    </Space>
  )
}

export function ParameterForm({
  form,
  parameters,
  value,
  onChange,
}: {
  form?: any
  parameters: ParameterInfo[]
  value?: ParameterFormValue
  onChange?: (next: ParameterFormValue) => void
}) {
  const [inner] = Form.useForm()
  const usedForm = form || inner

  const initialValues = useMemo(() => value || {}, [value])

  const renderInput = (param: ParameterInfo) => {
    const placeholder = param.placeholder || `请输入 ${param.name}`
    switch (param.type as ParameterType) {
      case 'number':
        return <InputNumber style={{ width: '100%' }} placeholder={placeholder} min={param.min} max={param.max} />
      case 'boolean':
        return <Switch checkedChildren="是" unCheckedChildren="否" />
      case 'select':
        return <Select placeholder={placeholder} options={(param.options || []).map((o) => ({ label: o, value: o }))} />
      case 'tags': {
        const maxItems = param.name === 'contrast' ? 2 : undefined
        return <TagsSelectInput placeholder={placeholder} options={(param.options || []).map((o) => ({ label: o, value: o }))} maxItems={maxItems} />
      }
      case 'file':
        return <FilePickerInput placeholder={placeholder} />
      case 'directory':
        return <DirectoryPickerInput placeholder={placeholder} />
      case 'text':
        return <TextArea rows={4} placeholder={placeholder} />
      case 'array':
        return <TextArea rows={3} placeholder={`请输入数组，每行一个元素\n${placeholder}`} />
      case 'color':
        return <SingleColorInput />
      case 'colorGradient':
        return <ColorGradientInput count={3} />
      case 'groupColors':
        return <GroupColorsInput />
      case 'string':
      default:
        return <Input placeholder={placeholder} />
    }
  }

  return (
    <Form
      form={usedForm}
      layout="vertical"
      initialValues={initialValues}
      onValuesChange={() => {
        const next = usedForm.getFieldsValue(true) as ParameterFormValue
        onChange?.(next)
      }}
    >
      {parameters.map((param) => (
        <Form.Item
          key={param.name}
          name={param.name}
          label={param.name}
          tooltip={param.description}
          initialValue={param.default}
          valuePropName={param.type === 'boolean' ? 'checked' : 'value'}
        >
          {renderInput(param)}
        </Form.Item>
      ))}
    </Form>
  )
}

