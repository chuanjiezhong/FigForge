import { useCallback, useMemo, useState, type CSSProperties, type MutableRefObject } from 'react'
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type OnNodesChange,
  type OnEdgesChange,
} from 'reactflow'
import { Collapse, Empty, Input, Select, Tooltip, message } from 'antd'
import type { ComposerModuleDef } from './pipelineComposerTypes'
import { newComposerNodeId, type ComposerNodeData } from './pipelineComposerUtils'
import styles from './index.module.less'

const NODE_WIDTH = 280

/** 与 function-docs 中 category 字段一致；顺序决定折叠面板排序 */
const CATEGORY_ORDER = ['transcriptomics', 'metabolomics', 'proteomics', 'single_cell', 'uncategorized', 'other']

const CATEGORY_LABELS: Record<string, string> = {
  transcriptomics: '转录组',
  metabolomics: '代谢组',
  proteomics: '蛋白组',
  single_cell: '单细胞',
  uncategorized: '未分类',
  other: '其他',
}

function labelForCategory(cat: string): string {
  return CATEGORY_LABELS[cat] || cat
}

type Props = {
  modules: ComposerModuleDef[]
  paletteCollapsed: boolean
  checkConnection?: (sourceId: string, targetId: string) => { ok: boolean; reason?: string; auto?: boolean }
  disabled: boolean
  rfRef: MutableRefObject<ReactFlowInstance | null>
  nodes: Node<ComposerNodeData>[]
  edges: Edge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  setNodes: React.Dispatch<React.SetStateAction<Node<ComposerNodeData>[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function PipelineComposerCanvas({
  modules,
  paletteCollapsed,
  checkConnection,
  disabled,
  rfRef,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  selectedId,
  onSelect,
}: Props) {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null)

  const connectability = useMemo(() => {
    if (!connectingFromId) return null
    const connectable = new Set<string>()
    const notReason: Record<string, string> = {}
    for (const n of nodes) {
      if (n.id === connectingFromId) continue
      if (!checkConnection) {
        connectable.add(n.id)
        continue
      }
      const res = checkConnection(connectingFromId, n.id)
      if (res.ok) connectable.add(n.id)
      else notReason[n.id] = res.reason || '上下游模块输入输出不兼容'
    }
    return { connectable, notReason }
  }, [connectingFromId, nodes, checkConnection])

  const categoriesPresent = useMemo(() => {
    const s = new Set<string>()
    for (const m of modules) {
      s.add(m.category || 'uncategorized')
    }
    return Array.from(s).sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a)
      const ib = CATEGORY_ORDER.indexOf(b)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
  }, [modules])

  const categoryOptions = useMemo(
    () => [
      { value: 'all', label: '全部组学' },
      ...categoriesPresent.map((c) => ({ value: c, label: labelForCategory(c) })),
    ],
    [categoriesPresent]
  )

  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase()
    return modules.filter((m) => {
      const cat = m.category || 'uncategorized'
      if (categoryFilter !== 'all' && cat !== categoryFilter) return false
      if (!q) return true
      return (
        m.title.toLowerCase().includes(q) ||
        m.functionName.toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q)
      )
    })
  }, [modules, search, categoryFilter])

  const modulesByCategory = useMemo(() => {
    const map = new Map<string, ComposerModuleDef[]>()
    for (const m of filteredModules) {
      const c = m.category || 'uncategorized'
      if (!map.has(c)) map.set(c, [])
      map.get(c)!.push(m)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
    }
    return map
  }, [filteredModules])

  const collapseKeysOrdered = useMemo(() => {
    const keys = Array.from(modulesByCategory.keys()).filter((k) => (modulesByCategory.get(k)?.length ?? 0) > 0)
    keys.sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a)
      const ib = CATEGORY_ORDER.indexOf(b)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
    return keys
  }, [modulesByCategory])

  const collapseItems = useMemo(
    () =>
      collapseKeysOrdered.map((cat) => {
        const list = modulesByCategory.get(cat) ?? []
        return {
          key: cat,
          label: `${labelForCategory(cat)}（${list.length}）`,
          children: (
            <div>
              {list.map((m) => (
                <div
                  key={m.key}
                  className={styles.paletteItem}
                  draggable={!disabled}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/pipeline-template', m.key)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  <div className={styles.paletteItemId}>{m.title}</div>
                  <div className={styles.paletteItemName}>{m.functionName}</div>
                </div>
              ))}
            </div>
          ),
        }
      }),
    [collapseKeysOrdered, modulesByCategory, disabled]
  )

  const onConnect = useCallback(
    (params: Connection) => {
      const src = nodes.find((n) => n.id === params.source)
      const tgt = nodes.find((n) => n.id === params.target)
      if (!src?.data || !tgt?.data) return
      if (src.id === tgt.id) {
        message.warning('不能把模块连接到自己')
        return
      }
      if (checkConnection) {
        const checked = checkConnection(src.id, tgt.id)
        if (!checked.ok) {
          message.warning(checked.reason || '上下游模块输入输出不兼容')
          return
        }
        if (checked.auto) {
          message.info(checked.reason || '该连线将自动补充中间步骤')
        }
      }
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: '#1677ff', strokeWidth: 2 },
          },
          eds
        )
      )
    },
    [nodes, setEdges, checkConnection]
  )

  const isValidConnection = useCallback(
    (conn: Connection) => {
      const src = nodes.find((n) => n.id === conn.source)
      const tgt = nodes.find((n) => n.id === conn.target)
      if (!src?.data || !tgt?.data) return false
      if (src.id === tgt.id) return false
      if (!checkConnection) return true
      return checkConnection(src.id, tgt.id).ok
    },
    [nodes, checkConnection]
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (disabled) return
      const moduleKey = e.dataTransfer.getData('application/pipeline-template')
      if (!moduleKey || !rfRef.current) return
      const mod = modules.find((m) => m.key === moduleKey)
      if (!mod) return
      const pos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const id = newComposerNodeId()
      setNodes((ns) => [
        ...ns,
        {
          id,
          position: pos,
          data: {
            moduleKey: mod.key,
            functionName: mod.functionName,
            title: mod.title,
            subtitle: mod.functionName,
            params: {},
            label: (
              <div className={styles.nodeLabel}>
                <div className={styles.nodeTitle}>{mod.title}</div>
                <div className={styles.nodeSub}>{mod.functionName}</div>
              </div>
            ),
          },
          style: {
            border: `1px solid ${selectedId === id ? '#1677ff' : '#d9d9d9'}`,
            borderRadius: 10,
            padding: 8,
            background: '#fff',
            width: NODE_WIDTH,
          },
        },
      ])
      onSelect(id)
    },
    [disabled, rfRef, modules, setNodes, onSelect, selectedId]
  )

  const styledNodes = nodes.map((n) => {
    const baseBorder =
      n.id === selectedId ? `2px solid #1677ff` : (n.style?.border as string) || '1px solid #d9d9d9'
    const st = { ...(n.style as CSSProperties), border: baseBorder }
    const baseLab =
      n.data.label ?? (
        <div className={styles.nodeLabel}>
          <div className={styles.nodeTitle}>{n.data.title}</div>
          <div className={styles.nodeSub}>{n.data.subtitle || n.data.functionName}</div>
        </div>
      )
    const isInConnectMode = Boolean(connectingFromId && connectability)
    const isSource = isInConnectMode && n.id === connectingFromId
    const isConnectable = isInConnectMode && !isSource && connectability!.connectable.has(n.id)
    const isNotConnectable = isInConnectMode && !isSource && !isConnectable
    const lab = isNotConnectable ? (
      <Tooltip title={connectability!.notReason[n.id]} mouseEnterDelay={0.15}>
        <div>{baseLab}</div>
      </Tooltip>
    ) : (
      baseLab
    )
    const highlightClass =
      isInConnectMode
        ? isSource
          ? styles.nodeConnectSource
          : isConnectable
            ? styles.nodeConnectableTarget
            : styles.nodeNotConnectableTarget
        : ''
    return {
      ...n,
      style: st,
      className: [n.className, highlightClass].filter(Boolean).join(' '),
      data: { ...n.data, label: lab },
    }
  })

  return (
    <div className={styles.composerRow}>
      {!paletteCollapsed ? (
        <div className={styles.palette}>
          <div className={styles.paletteTitle}>模块库</div>
          <div className={styles.paletteToolbar}>
            <Input
              allowClear
              size="small"
              placeholder="搜索中文说明或函数名"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              size="small"
              className={styles.paletteCategorySelect}
              value={categoryFilter}
              options={categoryOptions}
              onChange={(v) => setCategoryFilter(v)}
            />
          </div>
          <div className={styles.hint}>
            按组学分类展示（来自函数文档 category）；可先筛选组学再搜索。灰字为 R 函数名，可换行。
          </div>
          {filteredModules.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配模块" />
          ) : (
            <Collapse
              size="small"
              bordered={false}
              className={styles.paletteCollapse}
              defaultActiveKey={collapseKeysOrdered}
              items={collapseItems}
            />
          )}
        </div>
      ) : null}
      <div className={styles.composerGraph} onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={styledNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onConnectStart={(_, params: any) => {
            if (disabled) return
            const nodeId = params?.nodeId as string | undefined
            const handleType = params?.handleType as string | undefined
            if (!nodeId) return
            // 仅在从 source handle 拖出时进入高亮态（某些 node 类型不带 handleType，此时也允许）
            if (!handleType || handleType === 'source') setConnectingFromId(nodeId)
          }}
          onConnectEnd={() => setConnectingFromId(null)}
          onInit={(instance) => {
            rfRef.current = instance
            try {
              instance.fitView({ padding: 0.15, includeHiddenNodes: true })
            } catch {
              /* ignore */
            }
          }}
          onNodeClick={(_, node) => onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
          nodesConnectable={!disabled}
          nodesDraggable={!disabled}
          elementsSelectable={!disabled}
          deleteKeyCode={disabled ? null : 'Backspace'}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  )
}
