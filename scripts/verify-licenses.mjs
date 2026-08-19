import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageLockPath = resolve(projectRoot, 'package-lock.json')
const cargoManifestPath = resolve(projectRoot, 'src-tauri/Cargo.toml')
const cargoLockPath = resolve(projectRoot, 'src-tauri/Cargo.lock')
const noticePath = resolve(projectRoot, 'THIRD_PARTY_NOTICES.md')
const targetTriples = ['aarch64-apple-darwin', 'x86_64-apple-darwin']
const forbiddenLicense = /(?:^|[^A-Z])(?:AGPL|GPL|SSPL)(?:-|\b)/i
const unknownLicense = /^(?:UNKNOWN|UNLICENSED|NONE|N\/A)$/i

function fail(message) {
  console.error(message)
  process.exit(1)
}

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(`Unable to read ${description}.`)
  }
}

function assertAllowedLicense(ecosystem, name, version, license) {
  const normalized = typeof license === 'string' ? license.trim() : ''
  if (
    !normalized ||
    unknownLicense.test(normalized) ||
    /^SEE LICEN[CS]E IN\b/i.test(normalized) ||
    forbiddenLicense.test(normalized)
  ) {
    fail(`${ecosystem}: ${name} ${version} ${normalized || 'MISSING'}`)
  }
  return normalized
}

function packageNameFromLockPath(path, entry) {
  if (typeof entry.name === 'string' && entry.name.trim()) {
    return entry.name.trim()
  }
  return path.split('node_modules/').at(-1)
}

function collectNpmPackages() {
  const lock = readJson(packageLockPath, 'package-lock.json')
  if (lock.lockfileVersion !== 3 || !lock.packages) {
    fail('package-lock.json must use lockfileVersion 3 and include package metadata.')
  }

  const packages = []
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.dev === true) continue
    const name = packageNameFromLockPath(path, entry)
    const version = typeof entry.version === 'string' ? entry.version : ''
    if (!name || !version) fail('npm: MISSING MISSING MISSING')
    const license = assertAllowedLicense('npm', name, version, entry.license)
    packages.push({ name, version, license })
  }
  return packages
}

function loadCargoMetadata(targetTriple) {
  const result = spawnSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--format-version',
      '1',
      '--filter-platform',
      targetTriple,
      '--manifest-path',
      cargoManifestPath,
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )

  if (result.error || result.status !== 0) {
    fail(`Cargo metadata failed for ${targetTriple}; restore the locked Cargo cache and retry.`)
  }

  try {
    return JSON.parse(result.stdout)
  } catch {
    fail(`Cargo metadata returned invalid JSON for ${targetTriple}.`)
  }
}

function collectCargoPackages(metadata) {
  const normalizedManifestPath = resolve(cargoManifestPath)
  const root = metadata.packages.find(
    (candidate) => resolve(candidate.manifest_path) === normalizedManifestPath,
  )
  if (!root || !metadata.resolve) fail('Unable to find the Rust package in Cargo metadata.')

  const packageById = new Map(metadata.packages.map((candidate) => [candidate.id, candidate]))
  const nodeById = new Map(metadata.resolve.nodes.map((node) => [node.id, node]))
  const seen = new Set([root.id])
  const queue = [root.id]

  while (queue.length > 0) {
    const id = queue.pop()
    const node = nodeById.get(id)
    if (!node) continue

    for (const dependency of node.deps) {
      const isRuntimeDependency = dependency.dep_kinds.some(({ kind }) => kind === null)
      if (isRuntimeDependency && !seen.has(dependency.pkg)) {
        seen.add(dependency.pkg)
        queue.push(dependency.pkg)
      }
    }
  }

  seen.delete(root.id)
  return [...seen].map((id) => {
    const candidate = packageById.get(id)
    if (!candidate) fail('Cargo metadata contains an unresolved package identifier.')
    const license = assertAllowedLicense(
      'cargo',
      candidate.name,
      candidate.version,
      candidate.license,
    )
    return { name: candidate.name, version: candidate.version, license }
  })
}

function uniqueSorted(packages) {
  const unique = new Map()
  for (const candidate of packages) {
    const key = `${candidate.name}\u0000${candidate.version}\u0000${candidate.license}`
    unique.set(key, candidate)
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name, 'en') ||
      left.version.localeCompare(right.version, 'en') ||
      left.license.localeCompare(right.license, 'en'),
  )
}

function renderTable(packages) {
  return [
    '| Package | Version | License |',
    '| --- | --- | --- |',
    ...packages.map(({ name, version, license }) => `| ${name} | ${version} | ${license} |`),
  ].join('\n')
}

function renderNotice(npmPackages, cargoPackages) {
  return `# Third-Party Notices

This inventory covers production npm dependencies from \`package-lock.json\` and normal Rust
dependencies reachable from \`src-tauri/Cargo.lock\` for both supported macOS architectures.
Build-only and test-only dependencies are excluded. It is an inventory, not a substitute for the
license text or attribution requirements supplied by each dependency.

Regenerate after either lock file changes:

\`\`\`bash
npm run license:write
\`\`\`

CI verifies that this committed file is current with \`npm run license:check\`. The verifier rejects
missing or unknown license fields and GPL, AGPL, or SSPL license expressions.

## npm production dependencies

${renderTable(npmPackages)}

## Rust production dependencies

${renderTable(cargoPackages)}
`
}

// Cargo metadata is authoritative for license fields, while --locked binds its resolution to the
// committed Cargo.lock. Reading the file first produces a clear failure when the lock is missing.
readFileSync(cargoLockPath, 'utf8')
const npmPackages = uniqueSorted(collectNpmPackages())
const cargoPackages = uniqueSorted(
  targetTriples.flatMap((targetTriple) => collectCargoPackages(loadCargoMetadata(targetTriple))),
)
const expected = await format(renderNotice(npmPackages, cargoPackages), { parser: 'markdown' })

if (process.argv.includes('--write')) {
  writeFileSync(noticePath, expected, 'utf8')
  console.log(
    `Updated THIRD_PARTY_NOTICES.md (${npmPackages.length} npm, ${cargoPackages.length} Rust).`,
  )
} else {
  let actual
  try {
    actual = readFileSync(noticePath, 'utf8')
  } catch {
    fail('THIRD_PARTY_NOTICES.md is missing; run npm run license:write.')
  }
  if (actual !== expected) {
    fail('THIRD_PARTY_NOTICES.md is stale; run npm run license:write.')
  }
  console.log(
    `License inventory verified (${npmPackages.length} npm, ${cargoPackages.length} Rust).`,
  )
}
