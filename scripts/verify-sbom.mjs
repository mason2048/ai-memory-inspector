import { readFile } from 'node:fs/promises'

const [filePath] = process.argv.slice(2)
if (!filePath) throw new Error('Usage: node scripts/verify-sbom.mjs <cyclonedx-json>')

const document = JSON.parse(await readFile(filePath, 'utf8'))
const errors = []
if (document.bomFormat !== 'CycloneDX') errors.push('bomFormat must be CycloneDX')
if (typeof document.specVersion !== 'string') errors.push('specVersion is missing')
if (!document.metadata?.component?.name?.includes('ai-memory-inspector')) {
  errors.push('root component must identify ai-memory-inspector')
}
if (!Array.isArray(document.components) || document.components.length < 2) {
  errors.push('production dependency components are missing')
}
if (!Array.isArray(document.dependencies)) errors.push('dependency graph is missing')

if (errors.length) {
  throw new Error(`SBOM verification failed: ${errors.join('; ')}`)
}
process.stdout.write(
  `SBOM verified: CycloneDX ${document.specVersion}, ${document.components.length} components.\n`,
)
