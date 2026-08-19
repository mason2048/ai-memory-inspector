import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  createReleaseOverlay,
  ReleaseConfigError,
  validateUpdaterEndpoint,
  validateUpdaterPublicKey,
  writeReleaseOverlay,
} from './prepare-release-config.mjs'
import {
  verifyBaseUpdaterDisabled,
  verifyProductionOverlay,
  verifyReleaseConfig,
} from './verify-release-config.mjs'

const endpoint = 'https://updates.memory-inspector.app/v1/{{target}}/{{arch}}/{{current_version}}'
const minisignKey =
  'untrusted comment: minisign public key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3'
const publicKey = Buffer.from(minisignKey, 'utf8').toString('base64')
const projectRoot = resolve(import.meta.dirname, '..')
const prepareScript = resolve(import.meta.dirname, 'prepare-release-config.mjs')
const verifyScript = resolve(import.meta.dirname, 'verify-release-config.mjs')

function expectReleaseError(callback, code) {
  assert.throws(callback, (error) => error instanceof ReleaseConfigError && error.code === code)
}

test('creates and verifies the exact production updater overlay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ami-release-config-'))
  const output = join(directory, 'tauri.release.conf.json')
  const base = join(directory, 'tauri.conf.json')
  await writeFile(base, JSON.stringify({ bundle: {}, plugins: {} }))

  await writeReleaseOverlay({ endpoint, publicKey, output })
  const overlay = JSON.parse(await readFile(output, 'utf8'))

  assert.deepEqual(overlay, createReleaseOverlay({ endpoint, publicKey }))
  assert.equal(await verifyReleaseConfig({ base, overlay: output }), true)
})

test('rejects non-production updater endpoints', () => {
  const invalidEndpoints = [
    'http://updates.memory-inspector.app/v1/latest.json',
    'https://user:password@updates.memory-inspector.app/v1/latest.json',
    'https://updates.memory-inspector.app/v1/latest.json?channel=stable',
    'https://updates.memory-inspector.app/v1/latest.json#stable',
    'https://localhost/v1/latest.json',
    'https://127.0.0.1/v1/latest.json',
    'https://10.1.2.3/v1/latest.json',
    'https://172.31.1.2/v1/latest.json',
    'https://192.168.1.2/v1/latest.json',
    'https://[fc00::1]/v1/latest.json',
    'https://[fe80::1]/v1/latest.json',
    'https://example.com/v1/latest.json',
    'https://updates.example.org/v1/latest.json',
    'https://your-domain.invalid/v1/latest.json',
    'https://updates.memory-inspector.app/{{unknown}}',
    'https://updates.memory-inspector.app/one,https://updates.memory-inspector.app/two',
  ]

  for (const candidate of invalidEndpoints) {
    assert.throws(() => validateUpdaterEndpoint(candidate), ReleaseConfigError)
  }
  assert.equal(validateUpdaterEndpoint(endpoint), endpoint)
})

test('accepts only an outer-Base64 encoded Minisign public key', () => {
  assert.equal(validateUpdaterPublicKey(publicKey), publicKey)
  for (const candidate of [
    '',
    'placeholder-public-key',
    minisignKey,
    Buffer.from('not a minisign public key').toString('base64'),
    Buffer.from(
      'untrusted comment: minisign public key\nQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB',
    ).toString('base64'),
  ]) {
    assert.throws(() => validateUpdaterPublicKey(candidate), ReleaseConfigError)
  }
})

test('fails before writing and preserves an existing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ami-release-config-'))
  const output = join(directory, 'tauri.release.conf.json')
  await writeFile(output, 'existing-candidate')

  await assert.rejects(
    writeReleaseOverlay({
      endpoint: 'https://localhost/latest.json',
      publicKey,
      output,
    }),
    ReleaseConfigError,
  )
  assert.equal(await readFile(output, 'utf8'), 'existing-candidate')
})

test('base and overlay gates reject enabled defaults and unsafe extras', () => {
  assert.equal(verifyBaseUpdaterDisabled({ bundle: {}, plugins: {} }), true)
  expectReleaseError(
    () => verifyBaseUpdaterDisabled({ bundle: { createUpdaterArtifacts: true } }),
    'BASE_UPDATER_ARTIFACTS',
  )
  expectReleaseError(
    () => verifyBaseUpdaterDisabled({ bundle: { createUpdaterArtifacts: 'false' } }),
    'BASE_UPDATER_ARTIFACTS',
  )
  expectReleaseError(
    () => verifyBaseUpdaterDisabled({ plugins: { updater: {} } }),
    'BASE_UPDATER_PLUGIN',
  )

  const overlay = createReleaseOverlay({ endpoint, publicKey })
  assert.equal(verifyProductionOverlay(overlay), true)
  expectReleaseError(
    () =>
      verifyProductionOverlay({
        ...overlay,
        plugins: {
          updater: {
            ...overlay.plugins.updater,
            dangerousAcceptInvalidCerts: true,
          },
        },
      }),
    'OVERLAY_TLS',
  )
  expectReleaseError(
    () => verifyProductionOverlay({ ...overlay, unexpected: true }),
    'OVERLAY_SHAPE',
  )
})

test('CLI never exposes private-key environment values or invalid public values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ami-release-config-'))
  const output = join(directory, 'tauri.release.conf.json')
  const privateValue = 'PRIVATE-UPDATER-VALUE-MUST-NOT-APPEAR'
  const success = spawnSync(process.execPath, [prepareScript, '--output', output], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AMI_UPDATER_ENDPOINT: endpoint,
      AMI_UPDATER_PUBLIC_KEY: publicKey,
      AMI_UPDATER_PRIVATE_KEY: privateValue,
      TAURI_SIGNING_PRIVATE_KEY: privateValue,
    },
  })
  assert.equal(success.status, 0, success.stderr)
  const successfulEvidence = `${success.stdout}${success.stderr}${await readFile(output, 'utf8')}`
  assert.equal(successfulEvidence.includes(privateValue), false)

  const invalidEndpoint = 'https://user:EndpointSecret@example.com/latest?token=QuerySecret'
  const failure = spawnSync(process.execPath, [prepareScript, '--output', output], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AMI_UPDATER_ENDPOINT: invalidEndpoint,
      AMI_UPDATER_PUBLIC_KEY: 'PublicKeySecret',
    },
  })
  assert.notEqual(failure.status, 0)
  assert.equal(`${failure.stdout}${failure.stderr}`.includes('EndpointSecret'), false)
  assert.equal(`${failure.stdout}${failure.stderr}`.includes('QuerySecret'), false)
  assert.equal(`${failure.stdout}${failure.stderr}`.includes('PublicKeySecret'), false)
})

test('CLI verifier checks the repository base and generated overlay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ami-release-config-'))
  const output = join(directory, 'tauri.release.conf.json')
  const prepared = spawnSync(process.execPath, [prepareScript, '--output', output], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AMI_UPDATER_ENDPOINT: endpoint,
      AMI_UPDATER_PUBLIC_KEY: publicKey,
    },
  })
  assert.equal(prepared.status, 0, prepared.stderr)

  const verified = spawnSync(process.execPath, [verifyScript, '--overlay', output], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  assert.equal(verified.status, 0, verified.stderr)
  assert.match(verified.stdout, /configuration verified/i)
})
