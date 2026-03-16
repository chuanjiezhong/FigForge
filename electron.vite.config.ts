import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { viteCryptoPolyfill } from './vite-plugin-crypto-polyfill'
// import { viteObfuscator } from './vite-plugin-obfuscator' // 暂时禁用，先确保能正常构建

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      // 暂时禁用混淆，先确保能正常构建
      // viteObfuscator()
    ],
    build: {
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: false, // 保留 console，方便调试
          drop_debugger: true,
        },
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'main/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [
      externalizeDepsPlugin(),
      // 暂时禁用混淆，先确保能正常构建
      // viteObfuscator()
    ],
    build: {
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: false,
          drop_debugger: true,
        },
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'preload/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'renderer/src'),
        // 为 crypto 提供 polyfill
        'crypto': resolve(__dirname, 'renderer/src/polyfills/crypto-global.ts')
      },
      // 确保 fabric 模块正确解析
      dedupe: ['fabric']
    },
    plugins: [
      viteCryptoPolyfill(), // 必须在最前面，确保 crypto polyfill 先加载
      react(),
      // 暂时禁用混淆，先确保能正常构建
      // viteObfuscator()
    ],
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: 'globalThis',
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    css: {
      modules: {
        localsConvention: 'camelCase',
        generateScopedName: '[name]__[local]___[hash:base64:5]'
      }
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: false,
          drop_debugger: true,
        },
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'renderer/index.html')
        }
      }
    }
  }
})

