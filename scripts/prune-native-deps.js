// Netlify Functions run on Linux x64 (glibc). Both onnxruntime-node and
// sharp ship or pull in native binaries for platforms we'll never use
// (Windows, macOS, musl/Alpine Linux), which can push a single function
// past Netlify's 250MB size limit. This script deletes everything except
// what's actually needed at runtime, right after npm install.
import fs from 'node:fs'
import path from 'node:path'
 
const root = process.cwd()
 
function removeIfExists(relPath) {
  const fullPath = path.join(root, relPath)
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true })
    console.log(`[prune-native-deps] removed ${relPath}`)
  }
}
 
// --- onnxruntime-node: keep only bin/napi-v6/linux/x64 ---
const ortBinDir = path.join(root, 'node_modules/onnxruntime-node/bin/napi-v6')
if (fs.existsSync(ortBinDir)) {
  for (const platform of fs.readdirSync(ortBinDir)) {
    if (platform !== 'linux') {
      removeIfExists(`node_modules/onnxruntime-node/bin/napi-v6/${platform}`)
      continue
    }
    const platformDir = path.join(ortBinDir, platform)
    for (const arch of fs.readdirSync(platformDir)) {
      if (arch !== 'x64') {
        removeIfExists(`node_modules/onnxruntime-node/bin/napi-v6/${platform}/${arch}`)
      }
    }
  }
}
 
// --- sharp: keep only the glibc linux-x64 binaries, drop musl duplicates ---
removeIfExists('node_modules/@img/sharp-linuxmusl-x64')
removeIfExists('node_modules/@img/sharp-libvips-linuxmusl-x64')
 
console.log('[prune-native-deps] done.')
 
