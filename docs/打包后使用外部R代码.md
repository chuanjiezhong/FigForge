# 打包后使用外部 R 代码

打包后的 FigForge 应用支持通过以下方式使用外部 GitHub 仓库的 R 代码：

## 方式一：在应用内直接克隆（推荐）

用户可以在应用内直接输入 GitHub 仓库 URL，应用会自动克隆：

1. **打开应用设置**（需要实现 UI）
2. **添加 GitHub 仓库**：
   - 输入仓库 URL：`https://github.com/username/your-r-repo.git`
   - 可选：指定分支（默认 main）
   - 点击"克隆"按钮
3. **自动配置**：应用会自动：
   - 克隆仓库到 `~/.figforge/external-pipelines/` 目录
   - 添加到配置文件中
   - 刷新 Pipeline 列表

## 方式二：手动配置

用户也可以手动配置外部仓库路径：

### 1. 找到配置文件位置

**macOS:**
```
~/Library/Application Support/FigForge/pipeline-config.json
```

**Windows:**
```
%APPDATA%\FigForge\pipeline-config.json
```

**Linux:**
```
~/.config/FigForge/pipeline-config.json
```

### 2. 创建/编辑配置文件

如果配置文件不存在，创建它：

```json
{
  "localPipelinesDir": "./pipelines",
  "externalPipelinesDirs": [
    "~/r-pipelines",
    "/path/to/your/github/repo"
  ]
}
```

### 3. 克隆外部仓库

用户需要先手动克隆 GitHub 仓库：

```bash
# 克隆到任意位置
git clone https://github.com/username/your-r-repo.git ~/r-pipelines

# 或者在应用目录下
mkdir -p ~/.figforge/external-pipelines
cd ~/.figforge/external-pipelines
git clone https://github.com/username/your-r-repo.git
```

### 4. 重启应用

重启 FigForge 应用，外部 pipelines 会自动加载。

## 方式三：通过 API 调用（程序化）

如果需要在代码中自动添加外部仓库：

```typescript
// 检查 Git 是否可用
const { available } = await window.electronAPI.checkGitAvailable()

if (available) {
  // 克隆仓库
  const result = await window.electronAPI.cloneGitRepository(
    'https://github.com/username/your-r-repo.git',
    undefined, // 使用默认路径
    'main'     // 分支
  )
  
  if (result.success) {
    console.log('Repository cloned to:', result.path)
  }
}
```

## 系统要求

### 必需
- **Git**：需要安装 Git 才能克隆仓库
  - macOS: `brew install git`
  - Windows: 下载 Git for Windows
  - Linux: `sudo apt install git` 或 `sudo yum install git`

### 检查 Git 是否安装

```bash
git --version
```

如果未安装，需要先安装 Git。

## 默认存储位置

应用会自动将克隆的仓库保存到：

**macOS/Linux:**
```
~/.figforge/external-pipelines/{repo-name}/
```

**Windows:**
```
%USERPROFILE%\.figforge\external-pipelines\{repo-name}\
```

## 更新外部代码

### 方式一：在应用内更新

如果实现了 UI，用户可以在应用内点击"更新"按钮。

### 方式二：手动更新

```bash
cd ~/.figforge/external-pipelines/your-repo
git pull origin main
```

### 方式三：通过 API

```typescript
await window.electronAPI.updateGitRepository(
  '~/.figforge/external-pipelines/your-repo',
  'main'
)
```

## 配置文件示例

完整的配置文件示例：

```json
{
  "localPipelinesDir": "./pipelines",
  "externalPipelinesDirs": [
    "~/.figforge/external-pipelines/seurat-pipelines",
    "~/my-custom-pipelines",
    "/Users/username/shared-pipelines"
  ],
  "gitRepositories": [
    {
      "url": "https://github.com/yourlab/seurat-pipelines.git",
      "branch": "main",
      "localPath": "~/.figforge/external-pipelines/seurat-pipelines",
      "autoUpdate": false
    }
  ]
}
```

## 注意事项

1. **Git 依赖**：用户必须安装 Git 才能使用克隆功能
2. **网络连接**：克隆仓库需要网络连接
3. **权限**：确保应用有写入用户目录的权限
4. **私有仓库**：私有仓库需要配置 SSH 密钥或访问令牌
5. **R 依赖**：外部 R 代码的依赖包需要用户自己安装

## 故障排查

### Git 未安装

**错误**：`Git is not available`

**解决**：安装 Git
- macOS: `brew install git`
- Windows: 下载并安装 [Git for Windows](https://git-scm.com/download/win)
- Linux: `sudo apt install git`

### 克隆失败

**错误**：`Git clone failed`

**可能原因**：
1. 网络连接问题
2. 仓库 URL 错误
3. 私有仓库需要认证

**解决**：
1. 检查网络连接
2. 验证仓库 URL
3. 对于私有仓库，使用 SSH URL 或配置访问令牌

### Pipeline 未显示

**可能原因**：
1. 配置文件路径错误
2. 仓库结构不符合要求
3. 目录不存在

**解决**：
1. 检查配置文件位置和内容
2. 确保仓库有正确的目录结构（每个 pipeline 一个子目录，包含 `main.R`）
3. 检查目录路径是否正确

## 用户指南

建议在应用内提供以下功能（需要实现 UI）：

1. **设置页面**：
   - 显示当前配置的外部仓库
   - 添加/删除外部仓库
   - 更新仓库

2. **GitHub 仓库管理**：
   - 输入 URL 克隆仓库
   - 显示仓库状态
   - 一键更新

3. **Pipeline 列表**：
   - 显示所有可用的 pipelines（本地 + 外部）
   - 标识来源（本地/外部）
   - 显示版本信息

