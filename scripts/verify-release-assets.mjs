import { execFileSync } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('assets/app-icon-1024.png')
const icon = resolve('src-tauri/icons/icon.icns')
const entitlements = resolve('src-tauri/Entitlements.plist')

await Promise.all([access(source), access(icon), access(entitlements)])

const readImageProperty = (path, property) => {
  const output = execFileSync('sips', ['-g', property, path], { encoding: 'utf8' })
  const match = output.match(new RegExp(`${property}:\\s*(\\d+)`))
  if (!match) throw new Error(`cannot read ${property} from ${path}`)
  return Number(match[1])
}

if (
  readImageProperty(source, 'pixelWidth') !== 1024 ||
  readImageProperty(source, 'pixelHeight') !== 1024
) {
  throw new Error('production icon source must be exactly 1024x1024')
}
if ((await stat(icon)).size < 100_000)
  throw new Error('icon.icns appears to be an empty placeholder')

execFileSync('plutil', ['-lint', entitlements], { stdio: 'pipe' })
process.stdout.write(
  'Release assets verified: 1024px source, non-placeholder ICNS, valid entitlements.\n',
)
