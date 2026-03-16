import type { Plugin } from 'vite'

// 延迟加载 obfuscator，避免构建时的问题
let JavaScriptObfuscator: typeof import('javascript-obfuscator') | null = null

try {
  JavaScriptObfuscator = require('javascript-obfuscator')
} catch (e) {
  console.warn('javascript-obfuscator not available, skipping obfuscation')
}

/**
 * Vite 插件：代码混淆
 * 仅在生产环境启用
 */
export function viteObfuscator(): Plugin {
  return {
    name: 'vite-plugin-obfuscator',
    apply: 'build',
    enforce: 'post',
    generateBundle(options, bundle) {
      // 如果 obfuscator 不可用，跳过混淆
      if (!JavaScriptObfuscator) {
        return
      }
      
      // 只混淆 JavaScript 文件
      Object.keys(bundle).forEach((fileName) => {
        const chunk = bundle[fileName]
        if (chunk.type === 'chunk' && chunk.fileName.endsWith('.js')) {
          try {
            const obfuscationResult = JavaScriptObfuscator!.obfuscate(chunk.code, {
              compact: true,
              controlFlowFlattening: true,
              controlFlowFlatteningThreshold: 0.75,
              deadCodeInjection: true,
              deadCodeInjectionThreshold: 0.4,
              debugProtection: false, // 设置为 true 会阻止调试，但可能影响性能
              debugProtectionInterval: 0,
              disableConsoleOutput: false, // 设置为 true 会移除 console，可能影响调试
              identifierNamesGenerator: 'hexadecimal',
              log: false,
              numbersToExpressions: true,
              renameGlobals: false,
              selfDefending: true, // 防止代码格式化
              simplify: true,
              splitStrings: true,
              splitStringsChunkLength: 10,
              stringArray: true,
              stringArrayCallsTransform: true,
              stringArrayEncoding: ['base64'],
              stringArrayIndexShift: true,
              stringArrayRotate: true,
              stringArrayShuffle: true,
              stringArrayWrappersCount: 2,
              stringArrayWrappersChainedCalls: true,
              stringArrayWrappersParametersMaxCount: 4,
              stringArrayWrappersType: 'function',
              stringArrayThreshold: 0.75,
              transformObjectKeys: true,
              unicodeEscapeSequence: false,
            })

            chunk.code = obfuscationResult.getObfuscatedCode()
          } catch (error) {
            console.warn(`Failed to obfuscate ${fileName}:`, error)
          }
        }
      })
    },
  }
}

