import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'

const root = process.cwd()
const ignoredDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
])
const textExtensions = new Set([
  '',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.md',
  '.mjs',
  '.ndjson',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])
const allowedFixtures = new Set([
  'AKIA' + 'IOSFODNN7EXAMPLE',
  'AIza' + 'SyDUMMYONLYabcdefghijklmnopqrstu',
  'ghp_' + 'abcdefghijklmnopqrstuvwxyz123456',
  'sk-' + 'test_abcdefghijklmnop123456',
  'sk-' + 'test_abcdefghijklmnopqrstuvwxyz7Qx',
])
const detectors = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'GitHub personal access token', pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { name: 'Google API key', pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/g },
  { name: 'AWS access key', pattern: /\bAKIA[A-Z0-9]{16}\b/g },
]

async function collectFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...(await collectFiles(absolutePath)))
      continue
    }
    if (!entry.isFile() || !textExtensions.has(extname(entry.name))) continue
    if ((await stat(absolutePath)).size <= 2_000_000) files.push(absolutePath)
  }
  return files
}

const findings = []
for (const filePath of await collectFiles(root)) {
  const content = await readFile(filePath, 'utf8')
  for (const detector of detectors) {
    detector.pattern.lastIndex = 0
    for (const match of content.matchAll(detector.pattern)) {
      if (allowedFixtures.has(match[0])) continue
      const line = content.slice(0, match.index).split('\n').length
      findings.push(`${relative(root, filePath)}:${line} ${detector.name}`)
    }
  }
}

if (findings.length) {
  process.stderr.write(`Potential committed secrets found:\n${findings.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Secret scan passed; no non-fixture credentials matched.\n')
}
