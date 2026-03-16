/// <reference types="vite/client" />

// CSS Modules 类型声明
declare module '*.module.less' {
  const classes: { [key: string]: string }
  export default classes
}

declare module '*.less' {
  const content: string
  export default content
}

