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
- **Yarn**: 4.x（见 `package.json` 的 `packageManager`，建议 `corepack enable` 后使用）
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

### 常见问题：`lockfile` / `figforge@workspace` 报错

若出现 **`This package doesn't seem to be present in your lockfile`** 或 **`figforge@workspace:.`** 相关错误，通常是 **`package.json` 与 `yarn.lock` 不同步**，或 **混用了 npm 与 yarn**。

处理步骤：

1. **使用 Node 18+**（推荐按 `.nvmrc`：`nvm use`）。
2. 在项目根目录执行：**`yarn install`**，让 Yarn 4 更新锁文件（勿与 `npm install` 混用）。
3. 若仓库里存在 **`package-lock.json`**，请删除（本仓库以 **Yarn** 为准）。

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
- **转录组 pipeline 成功结束后**：若 R 包在输出目录 `_pipeline/` 生成了 `interpretation_zh.md` / `interpretation_en.md`，流程页右侧会显示 **「结果解读（中英草稿）」**，可预览并在访达中打开文件编辑

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

## Pipeline 与单函数：建议怎么用

**原则**：FigForge 里的 **Pipeline 界面**适合跑通**标准主干**（输入 → 标准化 → 差异 → 出图）；**细调阈值、重画某一类图、换基因列表**等，建议在 R 里**单独调用 OmicsFlowCore 函数**（或基于上一步输出目录再跑），避免把流程配置做成「驾驶舱」。

### 建议在 Pipeline 里只关心的（粗粒度）

| 类别 | 示例 |
|------|------|
| 数据与路径 | `out_dir`、`probe_file` / `ann_file`、`group_file`、多数据集时的 `datasets` |
| 对比与合并 | `contrast`、`merge_prefix`、`do_combat`（多数据集）、`overwrite` |
| 物种 / 类型 | `species`（count 流程）、数据集 `type`（multi_any） |
| 可选大开关 | 是否做 GeneID→Symbol（`annot_file` 等）、GEO 的 `gene_symbol_col` 等 |

### 建议不要依赖 Pipeline 配满、改单独函数更合适的（细粒度）

| 需求 | 更合适的做法 |
|------|----------------|
| 改 limma 阈值（logFC、FDR/P、top_n） | `transcriptome_plot_heatmap_limma()`，输入上一步标准化矩阵 |
| 只重画火山图 / 换标注基因数 | `transcriptome_plot_volcano()`，输入 `all_diff.txt` |
| 只重画热图 / 换配色与聚类 | `transcriptome_plot_heatmap_limma()` 或 `transcriptome_redraw_heatmap_rds()` |
| PCA 仅换标题或样式 | `transcriptome_plot_pca()` / `transcriptome_redraw_pca_rds()` |
| 合并矩阵再调 ComBat | `transcriptome_merge_normalize_combat()` 等单独步骤 |

### 进阶：`config` 与 `...`

R 包内 Pipeline 支持 `config`（按步骤覆盖）和顶层 `...`（传给差异热图等）。**产品策略上**：界面以**少量全局参数**为主；需要反复试的选项，**文档引导用户到单函数**更清晰。R 包侧更完整的说明见 **OmicsFlowCoreFullVersion** 仓库 README 中的「Pipeline 与单函数」一节。

### 后续加新流程（扩展口子）

新增组学或其它一键流程时，按 **`docs/extending-pipelines.md`** 清单操作即可：在 R 包 **`transcriptome_pipeline_defs()`** 里注册、导出函数、补充 **`function-docs.json`**；FigForge 流程图与下拉框会随定义自动更新，**一般不必改 Electron 核心**——只有需要类似「多数据集」专用表单时，再在 `PipelineView` 里为 `pipelineName` 加分支。

## 开发计划

- [x] 项目框架搭建
- [ ] R Pipeline 集成
- [ ] 排版编辑器完善
- [ ] 导出功能实现
- [ ] 期刊模板支持

