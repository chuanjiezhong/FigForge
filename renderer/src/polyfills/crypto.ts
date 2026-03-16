/**
 * Crypto polyfill for Electron environment
 * 确保 crypto.getRandomValues 在 Electron 环境中可用
 */

// 创建 crypto polyfill 函数
function createCryptoPolyfill(): Crypto {
  return {
    getRandomValues: (arr: Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array) => {
      // 使用 Math.random 生成随机值
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256) & 0xFF
      }
      return arr
    },
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0
        const v = c === 'x' ? r : (r & 0x3 | 0x8)
        return v.toString(16)
      })
    }
  } as Crypto
}

// 为 globalThis 添加 crypto polyfill
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  globalThis.crypto = createCryptoPolyfill()
}

// 确保 window.crypto 也指向同一个对象
if (typeof window !== 'undefined') {
  if (!window.crypto || !window.crypto.getRandomValues) {
    window.crypto = globalThis.crypto as Crypto
  }
}

export {}
