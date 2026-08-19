import { execFileSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const app = resolve(
  'src-tauri/target/universal-apple-darwin/release/bundle/macos/AI Memory Inspector.app',
)
const executable = resolve(app, 'Contents/MacOS/ai-memory-inspector')
const plist = resolve(app, 'Contents/Info.plist')
const icon = resolve(app, 'Contents/Resources/icon.icns')

await access(executable)
await access(plist)
await access(icon)
const architectures = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' })
  .trim()
  .split(/\s+/)
  .sort()
if (architectures.join(' ') !== 'arm64 x86_64') {
  throw new Error(`universal binary is incomplete: ${architectures.join(' ')}`)
}

const readPlist = (key) =>
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], {
    encoding: 'utf8',
  }).trim()
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
if (readPlist('CFBundleShortVersionString') !== packageJson.version) {
  throw new Error('bundle and package versions differ')
}
if (readPlist('CFBundleIdentifier') !== 'com.localfirst.aimemoryinspector') {
  throw new Error('unexpected bundle identifier')
}
if (readPlist('LSMinimumSystemVersion') !== '13.0') {
  throw new Error('unexpected minimum macOS version')
}
if (readPlist('CFBundleIconFile') !== 'icon.icns') {
  throw new Error('production bundle icon is not configured')
}
process.stdout.write(
  `Universal app verified: ${architectures.join('+')}, version ${packageJson.version}, macOS 13.0+.\n`,
)
