import { existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const RSCRIPT = process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'

/**
 * 解析 Rscript 可执行文件路径。
 * 打包后从 Finder 启动时 PATH 可能不包含 R，先尝试常见安装位置。
 */
export function getRscriptPath(): string {
  if (process.platform === 'darwin') {
    const candidates = ['/usr/local/bin/Rscript', '/opt/homebrew/bin/Rscript']
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
  }
  if (process.platform === 'win32') {
    const rHome = process.env.R_HOME
    if (rHome) {
      const p = join(rHome, 'bin', RSCRIPT)
      if (existsSync(p)) return p
    }
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    try {
      const fs = require('fs')
      const rDir = join(programFiles, 'R')
      if (existsSync(rDir)) {
        const versions = fs.readdirSync(rDir).filter((s: string) => s.startsWith('R-'))
        versions.sort().reverse()
        for (const ver of versions) {
          const p = join(rDir, ver, 'bin', RSCRIPT)
          if (existsSync(p)) return p
        }
      }
    } catch {
      // ignore
    }
  }
  if (process.platform === 'win32') {
    try {
      const out = execSync('where Rscript', { encoding: 'utf-8', windowsHide: true })
      const first = out.split(/\r?\n/)[0]?.trim()
      if (first && existsSync(first)) return first
    } catch {
      // where 未找到
    }
  } else {
    try {
      const path = execSync('which Rscript', { encoding: 'utf-8', env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' } }).trim()
      if (path && existsSync(path)) return path
    } catch {
      // which 未找到
    }
  }
  return RSCRIPT
}
