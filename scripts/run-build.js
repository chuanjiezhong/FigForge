#!/usr/bin/env node
/**
 * 在带有 crypto polyfill 的环境中执行 electron-vite build
 * 直接用 node --require 启动，确保 Vite 所在进程在解析配置前已注入 crypto
 */
const path = require('path')
const { spawnSync } = require('child_process')

const fixPath = path.resolve(__dirname, 'fix-crypto.js')
const electronViteBin = path.resolve(__dirname, '../node_modules/electron-vite/bin/electron-vite.js')

const r = spawnSync(process.execPath, ['--require', fixPath, electronViteBin, 'build'], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(r.status ?? 1)
