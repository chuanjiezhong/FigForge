import { readFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'

// 延迟加载 sharp，确保路径已设置
let sharp: typeof import('sharp')
async function getSharp() {
  if (!sharp) {
    // 在打包后的应用中，确保 sharp 能找到原生库
    if (app.isPackaged) {
      try {
        const sharpPath = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp')
        // 设置 sharp 的二进制路径
        process.env.SHARP_LIBVIPS_BINARY_PATH = join(sharpPath, 'lib', 'libvips-cpp.42.dylib')
      } catch (error) {
        console.error('Failed to configure sharp path:', error)
      }
    }
    sharp = await import('sharp')
  }
  return sharp
}

export interface ImageExportOptions {
  format: 'png' | 'tiff'
  dpi: number
  width?: number
  height?: number
}

export class ImageExporter {
  /**
   * 导出为图片
   */
  async exportToImage(
    layoutData: unknown,
    outputPath: string,
    options: ImageExportOptions
  ): Promise<void> {
    // 检查是否是包含 imageDataUrl 的对象（从 canvas 导出）
    const data = layoutData as { imageDataUrl?: string; json?: unknown }
    if (data?.imageDataUrl) {
      await this.exportImageDataUrlToImage(data.imageDataUrl, outputPath, options)
      return
    }
    
    // 检查是否是 SVG 数据
    if (this.isSVGData(layoutData)) {
      await this.exportSVGToImage(layoutData, outputPath, options)
      return
    }
    
    // 其他格式的处理
    throw new Error('Unsupported layout data format: 需要 imageDataUrl 或 SVG 数据')
  }

  /**
   * 从 imageDataUrl 导出图片
   */
  private async exportImageDataUrlToImage(
    imageDataUrl: string,
    outputPath: string,
    options: ImageExportOptions
  ): Promise<void> {
    const { format, dpi } = options

    // 获取 sharp 实例
    const sharpModule = await getSharp()
    const sharpInstance = sharpModule.default

    // 从 data URL 提取 base64 数据
    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '')
    const imageBuffer = Buffer.from(base64Data, 'base64')

    // 使用 sharp 处理图片
    let pipeline = sharpInstance(imageBuffer)

    // 设置 DPI
    pipeline = pipeline.withMetadata({
      density: dpi,
    })

    // 导出
    if (format === 'png') {
      await pipeline.png().toFile(outputPath)
    } else if (format === 'tiff') {
      // TIFF 导出，使用 LZW 压缩（无损）
      await pipeline.tiff({
        compression: 'lzw', // 使用 LZW 压缩（无损）
        quality: 100, // 最高质量
      }).toFile(outputPath)
    } else {
      throw new Error(`Unsupported format: ${format}`)
    }
  }

  private async exportSVGToImage(
    svgData: string,
    outputPath: string,
    options: ImageExportOptions
  ): Promise<void> {
    const { format, dpi, width, height } = options

    // 获取 sharp 实例
    const sharpModule = await getSharp()
    const sharpInstance = sharpModule.default

    // 计算像素尺寸（DPI 转换）
    const pixelWidth = width ? Math.round((width * dpi) / 72) : undefined
    const pixelHeight = height ? Math.round((height * dpi) / 72) : undefined

    let pipeline = sharpInstance(Buffer.from(svgData))

    if (pixelWidth || pixelHeight) {
      pipeline = pipeline.resize(pixelWidth, pixelHeight, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
    }

    // 设置 DPI
    pipeline = pipeline.withMetadata({
      density: dpi,
    })

    // 导出
    if (format === 'png') {
      await pipeline.png().toFile(outputPath)
    } else if (format === 'tiff') {
      // TIFF 导出，使用 LZW 压缩（无损）
      await pipeline.tiff({
        compression: 'lzw', // 使用 LZW 压缩（无损）
        quality: 100, // 最高质量
      }).toFile(outputPath)
    } else {
      throw new Error(`Unsupported format: ${format}`)
    }
  }

  private isSVGData(data: unknown): data is string {
    return typeof data === 'string' && data.trim().startsWith('<svg')
  }
}

