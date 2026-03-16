#!/usr/bin/env node
/**
 * 修复 Node.js crypto：为 globalThis 和 node:crypto 提供 getRandomValues
 * Vite 从 node:crypto 导入并调用 getRandomValues，故需在 --require 时同时 patch 二者
 */
const nodeCrypto = require('crypto')

function getRandomValues(arr) {
  const bytes = nodeCrypto.randomBytes(arr.length)
  for (let i = 0; i < arr.length; i++) arr[i] = bytes[i]
  return arr
}

// 1) 为 Node 内置 crypto 模块添加 getRandomValues（Vite 用 import from 'node:crypto'）
if (typeof nodeCrypto.getRandomValues !== 'function') {
  nodeCrypto.getRandomValues = getRandomValues
}

// 2) globalThis.crypto（部分依赖用全局 crypto）
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  globalThis.crypto = {
    getRandomValues,
    randomUUID: typeof nodeCrypto.randomUUID === 'function'
      ? nodeCrypto.randomUUID.bind(nodeCrypto)
      : () => nodeCrypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.crypto
}

