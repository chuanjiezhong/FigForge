# 应用图标资源

此目录用于存放应用图标文件。

## 需要的图标文件

### macOS
- `icon.icns` - macOS 应用图标（512x512 或更高）

### Windows
- `icon.ico` - Windows 应用图标（256x256 或更高，包含多个尺寸）

### Linux
- `icon.png` - Linux 应用图标（512x512 或更高）

## 图标生成工具

可以使用以下工具生成图标：

1. **在线工具**：
   - https://www.icoconverter.com/ (ICO)
   - https://cloudconvert.com/png-to-icns (ICNS)
   - https://www.electron.build/icons (Electron Builder 官方工具)

2. **命令行工具**：
   - `png2icons` (npm): `npm install -g png2icons`
   - `electron-icon-maker` (npm): `npm install -g electron-icon-maker`

## 快速生成

如果你有一个 1024x1024 的 PNG 图标：

```bash
# 安装工具
npm install -g electron-icon-maker

# 生成所有平台图标
electron-icon-maker --input=icon.png --output=./build
```

## 临时方案

如果没有图标，electron-builder 会使用默认图标。你可以先打包测试，后续再添加自定义图标。

