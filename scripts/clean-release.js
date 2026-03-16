#!/usr/bin/env node
/**
 * 清理 release 目录
 * 用法: node scripts/clean-release.js [platform]
 * platform: mac, win, linux, 或 all (默认)
 */

const fs = require('fs')
const path = require('path')

const platform = process.argv[2] || 'all'
const releaseDir = path.join(__dirname, '..', 'release')

const platforms = {
  mac: path.join(releaseDir, 'mac'),
  win: path.join(releaseDir, 'win'),
  linux: path.join(releaseDir, 'linux'),
}

function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    console.log(`删除目录: ${dirPath}`)
    fs.rmSync(dirPath, { recursive: true, force: true })
    console.log(`✓ 已删除: ${dirPath}`)
  } else {
    console.log(`目录不存在，跳过: ${dirPath}`)
  }
}

if (platform === 'all') {
  console.log('清理所有平台的打包文件...')
  Object.values(platforms).forEach(removeDir)
} else if (platforms[platform]) {
  console.log(`清理 ${platform} 平台的打包文件...`)
  removeDir(platforms[platform])
} else {
  console.error(`未知的平台: ${platform}`)
  console.error(`可用平台: ${Object.keys(platforms).join(', ')}, all`)
  process.exit(1)
}

console.log('清理完成！')

