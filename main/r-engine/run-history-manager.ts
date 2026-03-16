import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type RunStatus = 'running' | 'success' | 'error'

export interface RunRecord {
  id: string
  functionName: string
  packageName?: string
  startedAt: number
  finishedAt?: number
  status: RunStatus
  outputDir: string
  script: string
  error?: string
}

export interface RunHistoryStore {
  records: RunRecord[]
}

function getHistoryFilePath(): string {
  try {
    if (typeof require !== 'undefined') {
      const { app } = require('electron')
      if (app) {
        return join(app.getPath('userData'), 'run-history.json')
      }
    }
  } catch {
    // ignore
  }
  return join(__dirname, '../../run-history.json')
}

export class RunHistoryManager {
  private storePath = getHistoryFilePath()

  private loadStore(): RunHistoryStore {
    try {
      if (existsSync(this.storePath)) {
        const raw = readFileSync(this.storePath, 'utf-8')
        const parsed = JSON.parse(raw) as RunHistoryStore
        if (parsed && Array.isArray(parsed.records)) return parsed
      }
    } catch (e) {
      console.error('Failed to load run history:', e)
    }
    return { records: [] }
  }

  private saveStore(store: RunHistoryStore) {
    writeFileSync(this.storePath, JSON.stringify(store, null, 2), 'utf-8')
  }

  list(limit = 200): RunRecord[] {
    const store = this.loadStore()
    return store.records
      .slice()
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .slice(0, limit)
  }

  get(id: string): RunRecord | undefined {
    const store = this.loadStore()
    return store.records.find((r) => r.id === id)
  }

  create(record: RunRecord) {
    const store = this.loadStore()
    store.records.push(record)
    this.saveStore(store)
  }

  update(id: string, patch: Partial<RunRecord>) {
    const store = this.loadStore()
    const idx = store.records.findIndex((r) => r.id === id)
    if (idx === -1) return
    store.records[idx] = { ...store.records[idx], ...patch }
    this.saveStore(store)
  }

  delete(id: string) {
    const store = this.loadStore()
    store.records = store.records.filter((r) => r.id !== id)
    this.saveStore(store)
  }

  clear() {
    this.saveStore({ records: [] })
  }
}

