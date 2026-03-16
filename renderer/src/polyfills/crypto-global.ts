/**
 * Global crypto polyfill for Vite build process
 * 这个文件在构建时就会被加载，确保 crypto 在所有模块之前可用
 */

// 确保 globalThis 存在
if (typeof globalThis === 'undefined') {
  (global as any).globalThis = global
}

// 创建 crypto polyfill
const createCryptoPolyfill = () => {
  return {
    getRandomValues: (arr: Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array) => {
      // 在 Node.js 环境中使用 crypto 模块
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        try {
          const nodeCrypto = require('crypto')
          const bytes = nodeCrypto.randomBytes(arr.length)
          for (let i = 0; i < arr.length; i++) {
            arr[i] = bytes[i]
          }
          return arr
        } catch (e) {
          // fallback to Math.random
        }
      }
      // 使用 Math.random 作为后备
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256) & 0xFF
      }
      return arr
    },
    randomUUID: () => {
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        try {
          const nodeCrypto = require('crypto')
          return nodeCrypto.randomUUID()
        } catch (e) {
          // fallback
        }
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0
        const v = c === 'x' ? r : (r & 0x3 | 0x8)
        return v.toString(16)
      })
    }
  } as Crypto
}

// 设置 globalThis.crypto
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  globalThis.crypto = createCryptoPolyfill() as any
}

// 设置 window.crypto（如果 window 存在）
if (typeof window !== 'undefined') {
  if (!window.crypto || !window.crypto.getRandomValues) {
    window.crypto = globalThis.crypto as any
  }
}

export default globalThis.crypto
