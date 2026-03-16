/**
 * electron-builder afterPack hook
 * 确保 sharp 的原生依赖被正确包含
 */
const fs = require('fs')
const path = require('path')

module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context
  
  console.log('Running afterPack hook for sharp native dependencies...')
  console.log(`Platform: ${electronPlatformName}, Arch: ${arch}`)
  
  // sharp 的原生库路径
  const sharpLibPath = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'sharp')
  const sharpLibVipsPath = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '@img')
  
  // 检查路径是否存在
  if (fs.existsSync(sharpLibPath)) {
    console.log('✓ Sharp native libraries found in asar.unpacked')
  } else {
    console.warn('⚠ Sharp native libraries not found, may cause runtime errors')
  }
  
  if (fs.existsSync(sharpLibVipsPath)) {
    console.log('✓ Sharp libvips libraries found in asar.unpacked')
  } else {
    console.warn('⚠ Sharp libvips libraries not found, may cause runtime errors')
  }
}

