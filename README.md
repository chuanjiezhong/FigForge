# FigForge

科研可视化与图件生产平台

## 技术栈

- **桌面框架**: Electron
- **前端框架**: React + TypeScript
- **UI 库**: Ant Design
- **排版编辑器**: Fabric.js
- **构建工具**: Vite (electron-vite)
- **状态管理**: Zustand
- **R 调用**: Node.js child_process
- **PDF 导出**: Puppeteer
- **图片导出**: Sharp

## 项目结构

```
figforge/
├── main/                    # Electron 主进程
│   ├── main.ts
│   ├── r-engine/           # R 调用引擎
│   │   ├── r-processor.ts
│   │   └── pipeline-manager.ts
│   └── export-engine/      # 导出引擎
│       ├── pdf-exporter.ts
│       └── image-exporter.ts
├── preload/                # Preload 脚本
│   └── preload.ts
├── renderer/               # Electron 渲染进程（前端）
│   ├── src/
│   │   ├── components/
│   │   │   ├── LayoutEditor/  # 排版编辑器
│   │   │   ├── PanelList/     # Panel 列表
│   │   │   └── Toolbar/       # 工具栏
│   │   ├── stores/            # 状态管理
│   │   ├── utils/
│   │   └── App.tsx
│   └── index.html
├── pipelines/              # R Pipeline 脚本
│   ├── scRNA-seq/
│   ├── bulkRNA-seq/
│   └── microscopy/
├── templates/              # 期刊模板
│   └── nature/
└── docs/                   # 文档
```

## 环境要求

- **Node.js**: >= 18.17.0 (推荐使用 20.x LTS)
- **Yarn**: >= 1.22.0
- **R**: >= 4.0.0 (用于运行分析 Pipeline)

### Node 版本管理

项目使用 `.nvmrc` 文件指定 Node 版本。如果使用 nvm 管理 Node 版本：

```bash
# 切换到项目指定的 Node 版本
nvm use

# 或者手动切换（如果已安装）
nvm use 20.19.2
```

## 开发

### 安装依赖

```bash
# 确保使用正确的 Node 版本
nvm use

# 使用 yarn 安装依赖
yarn install
```

### 开发模式

```bash
yarn dev
```

### 构建

```bash
yarn build
```

### 预览

```bash
yarn preview
```

## 打包分发

### 构建应用

首先构建应用代码：

```bash
yarn build
```

### 打包成可执行文件

打包成可分发的应用（会自动清理旧文件）：

```bash
# 打包当前平台
yarn dist

# 打包 macOS (.dmg, .zip) - 会自动清理 release/mac/ 目录
yarn dist:mac

# 打包 Windows (.exe, .nsis) - 会自动清理 release/win/ 目录
yarn dist:win

# 打包 Linux (.AppImage, .deb) - 会自动清理 release/linux/ 目录
yarn dist:linux

# 仅打包不生成安装包（用于测试）
yarn pack
```

### 清理打包文件

如果需要手动清理打包文件：

```bash
# 清理所有平台的打包文件
yarn clean:release

# 清理特定平台的打包文件
yarn clean:release:mac
yarn clean:release:win
yarn clean:release:linux
```

### 打包输出

打包后的文件会按平台分别存放在 `release/` 目录下的子文件夹中：

- **macOS**: `release/mac/` 目录下
  - `FigForge-0.1.0.dmg` (安装包)
  - `FigForge-0.1.0-mac.zip` (解压即用)
  - `mac/` 和 `mac-arm64/` (未打包的应用目录)
  
- **Windows**: `release/win/` 目录下
  - `FigForge Setup 0.1.0.exe` (安装程序)
  - `FigForge-0.1.0.exe` (便携版)
  - `win-unpacked/` (未打包的应用目录)
  
- **Linux**: `release/linux/` 目录下
  - `FigForge-0.1.0.AppImage` (AppImage)
  - `figforge_0.1.0_amd64.deb` (Debian 包)
  - `linux-unpacked/` (未打包的应用目录)

### 应用图标

在打包前，建议在 `build/` 目录下添加应用图标：

- `build/icon.icns` - macOS 图标
- `build/icon.ico` - Windows 图标
- `build/icon.png` - Linux 图标

如果没有图标，electron-builder 会使用默认图标。

### 打包注意事项

1. **跨平台打包**：在 macOS 上可以打包 macOS 和 Linux，Windows 上可以打包 Windows 和 Linux
2. **代码签名**：生产环境建议配置代码签名（macOS 需要 Apple Developer 账号）
3. **文件大小**：首次打包会下载 Electron 二进制文件，可能需要一些时间
4. **R 环境**：打包的应用不包含 R，用户需要单独安装 R 环境

### 客户交付

打包完成后，将 `release/` 目录下对应平台的安装包文件提供给客户：

- **macOS 用户**：提供 `release/mac/` 目录下的 `.dmg` 文件
- **Windows 用户**：提供 `release/win/` 目录下的 `.exe` 安装程序或便携版
- **Linux 用户**：提供 `release/linux/` 目录下的 `.AppImage` 或 `.deb` 文件

同时建议提供：
- 使用说明文档
- R 环境安装指南
- 系统要求说明

### 打包目录结构

打包后的目录结构如下：

```
release/
├── mac/              # macOS 打包文件
│   ├── FigForge-0.1.0.dmg
│   ├── FigForge-0.1.0-mac.zip
│   └── ...
├── win/              # Windows 打包文件
│   ├── FigForge Setup 0.1.0.exe
│   ├── FigForge-0.1.0.exe
│   └── ...
└── linux/            # Linux 打包文件
    ├── FigForge-0.1.0.AppImage
    ├── figforge_0.1.0_amd64.deb
    └── ...
```

## 样式开发

项目使用 **Less** 和 **CSS Modules** 实现样式隔离：

- 全局样式：`renderer/src/index.less`
- 组件样式：`组件目录/index.module.less`
- CSS Modules 自动生成唯一类名，实现样式隔离

## 功能模块

### 1. 计算引擎（Analysis Engine）
- 调用本地 R/Rscript
- 支持多 pipeline
- JSON 参数输入
- 进度回调和日志输出

### 2. 渲染引擎（Rendering Engine）
- R/ggplot 输出 SVG

### 3. 排版编辑器（Layout Editor）
- 基于 Fabric.js 的交互式排版
- 支持拖拽、缩放、旋转
- 自动对齐、吸附
- 标注工具

### 4. 导出引擎（Export Engine）
- 支持 SVG/PDF/PNG/TIFF
- 支持高 DPI（300/600 dpi）
- 支持期刊模板

## 开发计划

- [x] 项目框架搭建
- [ ] R Pipeline 集成
- [ ] 排版编辑器完善
- [ ] 导出功能实现
- [ ] 期刊模板支持

