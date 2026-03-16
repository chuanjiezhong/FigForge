import type { Plugin } from 'vite'

/**
 * Vite 插件：注入 crypto polyfill
 * 确保在开发和生产环境中 crypto.getRandomValues 都可用
 */
export function viteCryptoPolyfill(): Plugin {
  return {
    name: 'vite-plugin-crypto-polyfill',
    enforce: 'pre',
    transformIndexHtml(html) {
      // 在 HTML 头部注入 crypto polyfill
      const cryptoPolyfill = `
    <script>
      // Crypto polyfill for Electron - 必须在所有模块加载前执行
      (function() {
        if (typeof globalThis === 'undefined') {
          window.globalThis = window;
        }
        if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
          globalThis.crypto = {
            getRandomValues: function(arr) {
              for (let i = 0; i < arr.length; i++) {
                arr[i] = Math.floor(Math.random() * 256) & 0xFF;
              }
              return arr;
            },
            randomUUID: function() {
              return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0;
                var v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
              });
            }
          };
        }
        if (typeof window !== 'undefined' && (!window.crypto || !window.crypto.getRandomValues)) {
          window.crypto = globalThis.crypto;
        }
      })();
    </script>`
      return html.replace('<head>', `<head>${cryptoPolyfill}`)
    },
    configResolved(config) {
      // 在配置解析后立即设置 crypto polyfill
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        try {
          if (typeof globalThis === 'undefined') {
            (global as any).globalThis = global
          }
          if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
            const nodeCrypto = require('crypto')
            globalThis.crypto = {
              getRandomValues: (arr: any) => {
                const bytes = nodeCrypto.randomBytes(arr.length)
                for (let i = 0; i < arr.length; i++) {
                  arr[i] = bytes[i]
                }
                return arr
              },
              randomUUID: () => nodeCrypto.randomUUID()
            } as any
          }
        } catch (e) {
          // 如果 require 失败，使用 Math.random 后备
          if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
            globalThis.crypto = {
              getRandomValues: (arr: any) => {
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
            } as any
          }
        }
      }
    },
    buildStart() {
      // 在构建开始时再次确保 crypto 可用
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        try {
          if (typeof globalThis === 'undefined') {
            (global as any).globalThis = global
          }
          if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
            const nodeCrypto = require('crypto')
            globalThis.crypto = {
              getRandomValues: (arr: any) => {
                const bytes = nodeCrypto.randomBytes(arr.length)
                for (let i = 0; i < arr.length; i++) {
                  arr[i] = bytes[i]
                }
                return arr
              },
              randomUUID: () => nodeCrypto.randomUUID()
            } as any
          }
        } catch (e) {
          // 忽略错误
        }
      }
    }
  }
}
