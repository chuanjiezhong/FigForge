export type RunStatus = 'running' | 'success' | 'error'

export type RunRecord = {
  id: string
  functionName: string
  packageName?: string
  startedAt: number
  finishedAt?: number
  status: RunStatus
  outputDir: string
  script: string
  error?: string
  /** 当次运行的参数（用于详情展示） */
  params?: Record<string, unknown>
  /** `pipeline`：Pipeline 页一键流程；未填则视为普通函数运行（兼容旧数据） */
  runKind?: 'function' | 'pipeline'
  /** 成功生成时写入，便于运行记录里直接打开解读稿路径 */
  interpretationPaths?: { zh?: string; en?: string; meta?: string }
  /** 用户在「运行记录」里补充的说明（可视为对解读稿的备注，不进 R 输出目录） */
  interpretationNotes?: { zh?: string; en?: string }
}

const STORAGE_KEY = 'figforge.runHistory.v1'
const MAX_RECORDS = 200

const listeners = new Set<() => void>()

function safeParse(raw: string | null): RunRecord[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as RunRecord[]
  } catch {
    return []
  }
}

function load(): RunRecord[] {
  return safeParse(localStorage.getItem(STORAGE_KEY))
}

function save(records: RunRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  for (const cb of listeners) cb()
}

export function subscribeRunHistory(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function listRunHistory(): RunRecord[] {
  return load()
    .slice()
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
}

export function addRunRecord(record: RunRecord) {
  const records = load()
  records.push(record)
  // cap & keep newest
  const next = records
    .slice()
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, MAX_RECORDS)
  save(next)
}

export function updateRunRecord(id: string, patch: Partial<RunRecord>) {
  const records = load()
  const idx = records.findIndex((r) => r.id === id)
  if (idx === -1) return
  records[idx] = { ...records[idx], ...patch }
  save(records)
}

export function deleteRunRecord(id: string) {
  const records = load().filter((r) => r.id !== id)
  save(records)
}

export function clearRunHistory() {
  save([])
}

export function newRunRecordId(startedAt: number) {
  return `run_${startedAt}_${Math.random().toString(36).slice(2, 10)}`
}

