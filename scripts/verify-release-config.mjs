import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  defaultReleaseConfigPath,
  ReleaseConfigError,
  validateUpdaterEndpoint,
  validateUpdaterPublicKey,
} from './prepare-release-config.mjs'

const DEFAULT_BASE = resolve(import.meta.dirname, '../src-tauri/tauri.conf.json')
const ROOT_KEYS = new Set(['bundle', 'plugins'])
const BUNDLE_KEYS = new Set(['createUpdaterArtifacts'])
const PLUGIN_KEYS = new Set(['updater'])
const UPDATER_KEYS = new Set([
  'dangerousInsecureTransportProtocol',
  'dangerousAcceptInvalidCerts',
  'dangerousAcceptInvalidHostnames',
  'endpoints',
  'pubkey',
])

function fail(code, message) {
  throw new ReleaseConfigError(code, message)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireOnlyKeys(value, allowed, field) {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    fail(`${field}_SHAPE`, `${field} contains unexpected configuration`)
  }
}

async function readJson(path, field) {
  try {
    const content = await readFile(path, 'utf8')
    const value = JSON.parse(content)
    if (!isPlainObject(value)) fail(`${field}_SHAPE`, `${field} must be a JSON object`)
    return value
  } catch (error) {
    if (error instanceof ReleaseConfigError) throw error
    fail(`${field}_READ`, `${field} could not be read as JSON`)
  }
}

export function verifyBaseUpdaterDisabled(base) {
  if (!isPlainObject(base)) {
    fail('BASE_CONFIG_SHAPE', 'base Tauri configuration must be a JSON object')
  }
  if (base.bundle !== undefined && !isPlainObject(base.bundle)) {
    fail('BASE_BUNDLE_SHAPE', 'base Tauri bundle configuration must be a JSON object')
  }
  if (base.plugins !== undefined && !isPlainObject(base.plugins)) {
    fail('BASE_PLUGINS_SHAPE', 'base Tauri plugin configuration must be a JSON object')
  }
  if (
    base.bundle?.createUpdaterArtifacts !== undefined &&
    base.bundle.createUpdaterArtifacts !== false
  ) {
    fail('BASE_UPDATER_ARTIFACTS', 'base Tauri configuration must not create updater artifacts')
  }
  if (base.plugins?.updater !== undefined) {
    fail('BASE_UPDATER_PLUGIN', 'base Tauri configuration must not contain updater settings')
  }
  return true
}

export function verifyProductionOverlay(overlay) {
  requireOnlyKeys(overlay, ROOT_KEYS, 'OVERLAY')
  requireOnlyKeys(overlay.bundle, BUNDLE_KEYS, 'OVERLAY_BUNDLE')
  requireOnlyKeys(overlay.plugins, PLUGIN_KEYS, 'OVERLAY_PLUGINS')
  requireOnlyKeys(overlay.plugins.updater, UPDATER_KEYS, 'OVERLAY_UPDATER')

  if (overlay.bundle.createUpdaterArtifacts !== true) {
    fail('OVERLAY_UPDATER_ARTIFACTS', 'release overlay must create updater artifacts')
  }

  const updater = overlay.plugins.updater
  if (
    updater.dangerousInsecureTransportProtocol !== false ||
    updater.dangerousAcceptInvalidCerts !== false ||
    updater.dangerousAcceptInvalidHostnames !== false
  ) {
    fail('OVERLAY_TLS', 'all dangerous updater transport and TLS options must be false')
  }
  if (!Array.isArray(updater.endpoints) || updater.endpoints.length !== 1) {
    fail('OVERLAY_ENDPOINT_COUNT', 'release overlay must contain exactly one updater endpoint')
  }

  validateUpdaterEndpoint(updater.endpoints[0])
  validateUpdaterPublicKey(updater.pubkey)
  return true
}

export function parseVerifyArguments(arguments_) {
  let base = DEFAULT_BASE
  let overlay = defaultReleaseConfigPath()
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--base' || argument === '--overlay') {
      const candidate = arguments_[index + 1]
      if (!candidate || candidate.startsWith('--')) {
        fail('VERIFY_ARGUMENT', `${argument} requires a path`)
      }
      if (argument === '--base') base = resolve(candidate)
      else overlay = resolve(candidate)
      index += 1
      continue
    }
    if (argument === '--help') return { help: true, base, overlay }
    fail('ARGUMENT_UNKNOWN', 'unsupported command-line argument')
  }
  return { help: false, base, overlay }
}

export async function verifyReleaseConfig({ base, overlay }) {
  const [baseConfig, releaseOverlay] = await Promise.all([
    readJson(base, 'BASE_CONFIG'),
    readJson(overlay, 'RELEASE_OVERLAY'),
  ])
  verifyBaseUpdaterDisabled(baseConfig)
  verifyProductionOverlay(releaseOverlay)
  return true
}

async function main() {
  const { help, base, overlay } = parseVerifyArguments(process.argv.slice(2))
  if (help) {
    process.stdout.write(
      'Usage: node scripts/verify-release-config.mjs [--base <path>] [--overlay <path>]\n',
    )
    return
  }
  await verifyReleaseConfig({ base, overlay })
  process.stdout.write(
    'Release updater configuration verified: base disabled, one production HTTPS endpoint, Minisign public key, strict TLS.\n',
  )
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    if (error instanceof ReleaseConfigError) {
      process.stderr.write(`${error.message}\n`)
    } else {
      process.stderr.write('RELEASE_CONFIG_VERIFY_FAILED: release configuration is invalid\n')
    }
    process.exitCode = 1
  })
}
