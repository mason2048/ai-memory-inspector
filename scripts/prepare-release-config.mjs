import { randomBytes } from 'node:crypto'
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TextDecoder } from 'node:util'

const DEFAULT_OUTPUT = join(tmpdir(), 'ai-memory-inspector-release', 'tauri.release.conf.json')
const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const BASE_CONFIG = resolve(PROJECT_ROOT, 'src-tauri/tauri.conf.json')
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const PLACEHOLDER_PATTERN =
  /(?:placeholder|change[- _]?me|replace[- _]?me|your[- _](?:domain|host|key)|todo|dummy|example)/i
const ALLOWED_TAURI_TOKENS = ['{{target}}', '{{arch}}', '{{current_version}}']

export class ReleaseConfigError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'ReleaseConfigError'
    this.code = code
  }
}

function fail(code, message) {
  throw new ReleaseConfigError(code, message)
}

function requireCleanString(value, field, maximumLength) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${field}_MISSING`, `${field} is required`)
  }
  if (value !== value.trim()) {
    fail(`${field}_WHITESPACE`, `${field} must not have surrounding whitespace`)
  }
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
  })
  if (value.length > maximumLength || hasControlCharacter) {
    fail(`${field}_FORMAT`, `${field} has an invalid format`)
  }
  return value
}

function isNonPublicIpv4(hostname) {
  const octets = hostname.split('.').map(Number)
  const [first, second, third] = octets

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  )
}

function isNonPublicIpv6(hostname) {
  const normalized = hostname.toLowerCase()
  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4 && isIP(mappedIpv4) === 4) return isNonPublicIpv4(mappedIpv4)

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    /^(?:fc|fd)/.test(normalized) ||
    /^fe[89a-f]/.test(normalized) ||
    /^ff/.test(normalized) ||
    /^2001:db8(?::|$)/.test(normalized)
  )
}

function isNonPublicHostname(hostname) {
  const normalized = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  const ipVersion = isIP(normalized)
  if (ipVersion === 4) return isNonPublicIpv4(normalized)
  if (ipVersion === 6) return isNonPublicIpv6(normalized)

  if (!normalized.includes('.')) return true
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home') ||
    normalized.endsWith('.home.arpa') ||
    normalized.endsWith('.test') ||
    normalized.endsWith('.invalid') ||
    normalized.endsWith('.example') ||
    normalized === 'example.com' ||
    normalized.endsWith('.example.com') ||
    normalized === 'example.net' ||
    normalized.endsWith('.example.net') ||
    normalized === 'example.org' ||
    normalized.endsWith('.example.org')
  )
}

function rejectUnknownPlaceholders(value, field) {
  let probe = value
  for (const token of ALLOWED_TAURI_TOKENS) probe = probe.replaceAll(token, '')
  if (PLACEHOLDER_PATTERN.test(probe) || /{{|}}|<[^>]*>|\$\{|%7b%7b|%7d%7d/i.test(probe)) {
    fail(`${field}_PLACEHOLDER`, `${field} must not contain placeholder content`)
  }
}

export function validateUpdaterEndpoint(input) {
  const endpoint = requireCleanString(input, 'UPDATER_ENDPOINT', 2_048)
  if (/\s|,|;/.test(endpoint)) {
    fail('UPDATER_ENDPOINT_COUNT', 'exactly one updater endpoint is required')
  }
  rejectUnknownPlaceholders(endpoint, 'UPDATER_ENDPOINT')

  let url
  try {
    url = new URL(endpoint)
  } catch {
    fail('UPDATER_ENDPOINT_FORMAT', 'updater endpoint must be an absolute URL')
  }
  if (url.protocol !== 'https:') {
    fail('UPDATER_ENDPOINT_HTTPS', 'updater endpoint must use HTTPS')
  }
  if (url.username || url.password) {
    fail('UPDATER_ENDPOINT_CREDENTIALS', 'updater endpoint must not contain credentials')
  }
  if (url.search || url.hash) {
    fail('UPDATER_ENDPOINT_COMPONENTS', 'updater endpoint must not contain query or hash data')
  }
  if (isNonPublicHostname(url.hostname)) {
    fail('UPDATER_ENDPOINT_HOST', 'updater endpoint must use a public production hostname')
  }

  return endpoint
}

function decodeCanonicalBase64(value, field) {
  if (!BASE64_PATTERN.test(value)) {
    fail(`${field}_FORMAT`, `${field} must be canonical Base64`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) {
    fail(`${field}_FORMAT`, `${field} must be canonical Base64`)
  }
  return bytes
}

export function validateUpdaterPublicKey(input) {
  const publicKey = requireCleanString(input, 'UPDATER_PUBLIC_KEY', 8_192)
  if (PLACEHOLDER_PATTERN.test(publicKey) || /PRIVATE KEY/i.test(publicKey)) {
    fail('UPDATER_PUBLIC_KEY_PLACEHOLDER', 'updater public key is not a production public key')
  }

  const publicKeyFileBytes = decodeCanonicalBase64(publicKey, 'UPDATER_PUBLIC_KEY')
  let publicKeyFile
  try {
    publicKeyFile = new TextDecoder('utf-8', { fatal: true }).decode(publicKeyFileBytes)
  } catch {
    fail('UPDATER_PUBLIC_KEY_FORMAT', 'updater public key must encode a Minisign public key')
  }

  const normalized = publicKeyFile.replaceAll('\r\n', '\n').replace(/\n$/, '')
  const lines = normalized.split('\n')
  if (
    lines.length !== 2 ||
    !lines[0].startsWith('untrusted comment:') ||
    PLACEHOLDER_PATTERN.test(normalized) ||
    /PRIVATE KEY/i.test(normalized)
  ) {
    fail('UPDATER_PUBLIC_KEY_FORMAT', 'updater public key must encode a Minisign public key')
  }

  const keyBytes = decodeCanonicalBase64(lines[1], 'UPDATER_PUBLIC_KEY')
  if (
    keyBytes.length !== 42 ||
    keyBytes[0] !== 0x45 ||
    (keyBytes[1] !== 0x64 && keyBytes[1] !== 0x44)
  ) {
    fail('UPDATER_PUBLIC_KEY_FORMAT', 'updater public key must encode a Minisign public key')
  }

  return publicKey
}

export function createReleaseOverlay({ endpoint, publicKey }) {
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        dangerousInsecureTransportProtocol: false,
        dangerousAcceptInvalidCerts: false,
        dangerousAcceptInvalidHostnames: false,
        endpoints: [validateUpdaterEndpoint(endpoint)],
        pubkey: validateUpdaterPublicKey(publicKey),
      },
    },
  }
}

export function defaultReleaseConfigPath() {
  return DEFAULT_OUTPUT
}

export function parsePrepareArguments(arguments_) {
  let output = DEFAULT_OUTPUT
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--output') {
      const candidate = arguments_[index + 1]
      if (!candidate || candidate.startsWith('--')) {
        fail('OUTPUT_ARGUMENT', '--output requires a path')
      }
      output = resolve(candidate)
      index += 1
      continue
    }
    if (argument === '--help') return { help: true, output }
    fail('ARGUMENT_UNKNOWN', 'unsupported command-line argument')
  }
  if (resolve(output) === BASE_CONFIG) {
    fail('OUTPUT_BASE_CONFIG', 'release overlay must not overwrite the base Tauri configuration')
  }
  return { help: false, output: resolve(output) }
}

export async function writeReleaseOverlay({ endpoint, publicKey, output = DEFAULT_OUTPUT }) {
  const destination = resolve(output)
  if (destination === BASE_CONFIG) {
    fail('OUTPUT_BASE_CONFIG', 'release overlay must not overwrite the base Tauri configuration')
  }

  const overlay = createReleaseOverlay({ endpoint, publicKey })
  const directory = dirname(destination)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const [canonicalDirectory, canonicalBaseDirectory] = await Promise.all([
    realpath(directory),
    realpath(dirname(BASE_CONFIG)),
  ])
  if (
    resolve(canonicalDirectory, basename(destination)) ===
    resolve(canonicalBaseDirectory, basename(BASE_CONFIG))
  ) {
    fail('OUTPUT_BASE_CONFIG', 'release overlay must not overwrite the base Tauri configuration')
  }
  const temporaryPath = join(
    directory,
    `.${basename(destination)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  )
  try {
    await writeFile(temporaryPath, `${JSON.stringify(overlay, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await rename(temporaryPath, destination)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
  return destination
}

async function main() {
  const { help, output } = parsePrepareArguments(process.argv.slice(2))
  if (help) {
    process.stdout.write(
      'Usage: node scripts/prepare-release-config.mjs [--output <overlay-path>]\n',
    )
    return
  }

  const destination = await writeReleaseOverlay({
    endpoint: process.env.AMI_UPDATER_ENDPOINT,
    publicKey: process.env.AMI_UPDATER_PUBLIC_KEY,
    output,
  })
  process.stdout.write(`Release updater overlay written to ${destination}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    if (error instanceof ReleaseConfigError) {
      process.stderr.write(`${error.message}\n`)
    } else {
      process.stderr.write('RELEASE_CONFIG_WRITE_FAILED: could not write release overlay\n')
    }
    process.exitCode = 1
  })
}
