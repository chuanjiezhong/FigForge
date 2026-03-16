# 外部 R 代码集成说明

FigForge 支持集成外部 GitHub 仓库的 R 代码，**打包后的应用也可以使用**。有几种方式可以实现：

> **重要**：打包后的应用使用方式请参考 [打包后使用外部R代码.md](./打包后使用外部R代码.md)

## 方案一：Git Submodule（推荐）

将外部 GitHub 仓库作为 Git 子模块添加到项目中：

```bash
# 在项目根目录执行
git submodule add https://github.com/username/your-r-repo.git external-pipelines/your-r-repo

# 初始化子模块
git submodule update --init --recursive
```

然后在 `pipeline-config.json` 中配置：

```json
{
  "localPipelinesDir": "./pipelines",
  "externalPipelinesDirs": [
    "./external-pipelines/your-r-repo"
  ]
}
```

**优点：**
- 版本控制清晰
- 可以指定特定版本/分支
- 易于更新和维护

## 方案二：直接克隆到本地

手动克隆外部仓库到本地目录：

```bash
# 克隆到项目外部
git clone https://github.com/username/your-r-repo.git ~/r-pipelines

# 或者在项目内创建 external-pipelines 目录
mkdir -p external-pipelines
cd external-pipelines
git clone https://github.com/username/your-r-repo.git
```

然后在 `pipeline-config.json` 中配置路径：

```json
{
  "externalPipelinesDirs": [
    "~/r-pipelines",
    "./external-pipelines/your-r-repo"
  ]
}
```

## 方案三：使用配置文件

创建 `pipeline-config.json` 文件（参考 `pipeline-config.json.example`）：

```json
{
  "localPipelinesDir": "./pipelines",
  "externalPipelinesDirs": [
    "/absolute/path/to/your/r/repo",
    "./relative/path/to/another/repo"
  ]
}
```

## R 代码仓库结构要求

外部 R 代码仓库应该遵循以下结构：

```
your-r-repo/
├── pipeline1/
│   ├── main.R              # 主脚本（必需）
│   ├── pipeline.json       # Pipeline 信息（可选）
│   └── ...                 # 其他依赖文件
├── pipeline2/
│   ├── main.R
│   └── ...
└── ...
```

### pipeline.json 格式（可选）

```json
{
  "name": "Pipeline 名称",
  "description": "Pipeline 描述",
  "version": "1.0.0",
  "author": "作者",
  "dependencies": {
    "r_packages": ["ggplot2", "dplyr", "Seurat"]
  }
}
```

### main.R 脚本要求

R 脚本需要接受两个命令行参数：

```r
# main.R
args <- commandArgs(trailingOnly = TRUE)
params_path <- args[1]  # 参数 JSON 文件路径
output_dir <- args[2]   # 输出目录

# 读取参数
params <- jsonlite::fromJSON(params_path)

# 执行分析
# ...

# 输出结果到 output_dir
```

## 使用方式

### 1. 创建配置文件

复制示例配置文件：

```bash
cp pipeline-config.json.example pipeline-config.json
```

### 2. 编辑配置

编辑 `pipeline-config.json`，添加你的外部仓库路径。

### 3. 重启应用

重启 FigForge 应用，外部 pipelines 会自动加载。

### 4. 在应用中使用

- 外部 pipelines 会显示在 Pipeline 列表中
- ID 格式为：`external_pipeline_name`
- 可以像本地 pipelines 一样使用

## 更新外部代码

### Git Submodule 方式

```bash
# 更新子模块到最新版本
git submodule update --remote external-pipelines/your-r-repo

# 或者进入子模块目录手动更新
cd external-pipelines/your-r-repo
git pull origin main
```

### 直接克隆方式

```bash
cd /path/to/your/r/repo
git pull origin main
```

## 注意事项

1. **路径格式**：
   - 支持绝对路径：`/Users/username/r-pipelines`
   - 支持相对路径：`./external-pipelines/repo`
   - 支持 `~` 展开：`~/r-pipelines`

2. **权限**：
   - 确保应用有读取外部目录的权限

3. **依赖**：
   - 外部 R 代码的依赖需要在使用前安装
   - 建议在 `pipeline.json` 中声明依赖

4. **版本管理**：
   - 使用 Git Submodule 可以锁定特定版本
   - 直接克隆需要手动管理版本

## 示例：集成 Seurat 分析 Pipeline

假设你有一个 GitHub 仓库 `https://github.com/yourlab/seurat-pipelines`：

1. **添加为子模块**：
```bash
git submodule add https://github.com/yourlab/seurat-pipelines.git external-pipelines/seurat
```

2. **配置**：
```json
{
  "externalPipelinesDirs": [
    "./external-pipelines/seurat"
  ]
}
```

3. **使用**：
- Pipeline ID: `external_scRNA-seq`（如果仓库中有 `scRNA-seq` 目录）
- 在应用中直接调用即可

## 故障排查

### Pipeline 未显示

1. 检查 `pipeline-config.json` 路径是否正确
2. 检查外部目录是否存在
3. 检查目录结构是否符合要求（需要有子目录和 `main.R`）
4. 查看应用控制台的错误信息

### R 脚本执行失败

1. 检查 R 环境是否正确安装
2. 检查 R 脚本的依赖包是否已安装
3. 检查脚本路径和参数传递是否正确
4. 查看 R 执行日志

