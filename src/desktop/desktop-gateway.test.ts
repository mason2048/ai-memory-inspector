import { describe, expect, it, vi } from 'vitest'
import { BrowserMvpGateway } from './browser-mvp-gateway'
import type { OperationProgress } from './contracts'
import { createDesktopGateway } from './index'
import { runDesktopOperation, sanitizeOperationProgress } from './operation'
import { SafeError, toSafeError } from './safe-error'
import { readTauriInternals, TAURI_COMMANDS, TauriGateway } from './tauri-gateway'

describe('desktop production gateway', () => {
  it('uses the browser MVP gateway when Tauri internals are absent or unsafe to read', async () => {
    const browser = createDesktopGateway({})
    expect(browser).toBeInstanceOf(BrowserMvpGateway)
    expect((await browser.getRuntimeInfo()).capabilities).toEqual({
      nativeVault: false,
      nativeFileImport: false,
      systemVerification: false,
      localOnly: true,
    })
    expect(await browser.getVaultStatus()).toEqual({ state: 'unavailable' })

    const hostileScope = Object.defineProperty({}, '__TAURI_INTERNALS__', {
      get() {
        throw new Error('/Users/private/secret.txt')
      },
    })
    expect(readTauriInternals(hostileScope)).toBeUndefined()
    const failClosedDesktop = createDesktopGateway(hostileScope)
    expect(failClosedDesktop).toBeInstanceOf(TauriGateway)
    await expect(failClosedDesktop.getRuntimeInfo()).rejects.toMatchObject({
      code: 'RUNTIME_UNAVAILABLE',
    })

    const missingBridge = createDesktopGateway({ __TAURI_METADATA__: { currentWindow: 'main' } })
    expect(missingBridge).toBeInstanceOf(TauriGateway)
    await expect(missingBridge.getRuntimeInfo()).rejects.toMatchObject({
      code: 'RUNTIME_UNAVAILABLE',
    })
  })

  it('dynamically selects Tauri and invokes only allowlisted commands with empty arguments', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === TAURI_COMMANDS.verifySystemIdentity)
        return { state: 'unlocked', changedAt: '2026-08-13T01:02:04.000Z' }
      if (command === TAURI_COMMANDS.projectRead)
        return { revision: 0, schemaVersion: 2, project: null }
      if (command === TAURI_COMMANDS.projectWrite)
        return { revision: 1, schemaVersion: 2, project: { version: 2 } }
      if (command === TAURI_COMMANDS.projectClear)
        return { revision: 2, schemaVersion: 2, project: null }
      if (command === TAURI_COMMANDS.backupExport)
        return { completed: true, cancelled: false, revision: 2, schemaVersion: 2 }
      if (command === TAURI_COMMANDS.backupRestore)
        return { completed: false, cancelled: true, revision: 0, schemaVersion: 2 }
      if (command === TAURI_COMMANDS.importPickAndRead) return { cancelled: true }
      return { state: 'locked', changedAt: '2026-08-13T01:02:03.000Z' }
    })
    const scope = { __TAURI_INTERNALS__: { invoke } }
    const gateway = createDesktopGateway(scope)

    expect(gateway).toBeInstanceOf(TauriGateway)
    expect((await gateway.getRuntimeInfo()).kind).toBe('tauri')
    await expect(gateway.getVaultStatus()).resolves.toMatchObject({ state: 'locked' })
    await expect(gateway.verifySystemIdentity()).resolves.toMatchObject({ state: 'unlocked' })
    await expect(gateway.lockVault()).resolves.toMatchObject({ state: 'locked' })
    await expect(gateway.readProject()).resolves.toEqual({
      revision: 0,
      schemaVersion: 2,
      project: null,
    })
    await expect(gateway.writeProject(0, { version: 2 })).resolves.toMatchObject({
      revision: 1,
      project: { version: 2 },
    })
    await expect(gateway.clearProject(1)).resolves.toEqual({
      revision: 2,
      schemaVersion: 2,
      project: null,
    })
    await expect(gateway.exportBackup('fictional recovery phrase')).resolves.toMatchObject({
      completed: true,
    })
    await expect(gateway.restoreBackup('fictional recovery phrase')).resolves.toMatchObject({
      cancelled: true,
    })
    await expect(gateway.pickAndReadImport()).resolves.toEqual({ cancelled: true })
    expect(invoke.mock.calls).toEqual([
      [TAURI_COMMANDS.vaultStatus, {}],
      [TAURI_COMMANDS.verifySystemIdentity, {}],
      [TAURI_COMMANDS.lockVault, {}],
      [TAURI_COMMANDS.projectRead, {}],
      [
        TAURI_COMMANDS.projectWrite,
        {
          request: { expectedRevision: 0, project: { version: 2 } },
        },
      ],
      [TAURI_COMMANDS.projectClear, { request: { expectedRevision: 1 } }],
      [TAURI_COMMANDS.backupExport, { request: { passphrase: 'fictional recovery phrase' } }],
      [TAURI_COMMANDS.backupRestore, { request: { passphrase: 'fictional recovery phrase' } }],
      [TAURI_COMMANDS.importPickAndRead, {}],
    ])
    expect((await gateway.getRuntimeInfo()).capabilities.systemVerification).toBe(true)
    expect((await gateway.getRuntimeInfo()).capabilities.nativeFileImport).toBe(true)
  })

  it('resolves Tauri internals at operation time instead of retaining a stale native object', async () => {
    let state: 'locked' | 'unlocked' = 'locked'
    let internals = { invoke: vi.fn(async () => ({ state })) }
    const gateway = new TauriGateway(() => internals)

    await expect(gateway.getVaultStatus()).resolves.toEqual({ state: 'locked' })
    state = 'unlocked'
    internals = { invoke: vi.fn(async () => ({ state })) }
    await expect(gateway.getVaultStatus()).resolves.toEqual({ state: 'unlocked' })
    expect(internals.invoke).toHaveBeenCalledOnce()
  })

  it('accepts a bounded native import without receiving or sending a path', async () => {
    const content = '{"content":"完全虚构"}\n'
    const invoke = vi.fn(async () => ({
      cancelled: false,
      file: {
        basename: 'fictional.jsonl',
        format: 'jsonl',
        sizeBytes: new TextEncoder().encode(content).byteLength,
        estimatedRecords: 1,
        secretFindings: 0,
        containsSecret: false,
        limits: {
          maxFileBytes: 25 * 1024 * 1024,
          maxRecords: 5_000,
          maxRecordBytes: 256 * 1024,
          maxJsonDepth: 32,
          maxRules: 100,
          maxRuleBytes: 256 * 1024,
        },
        content,
      },
    }))
    const gateway = new TauriGateway(() => ({ invoke }))

    await expect(gateway.pickAndReadImport()).resolves.toMatchObject({
      cancelled: false,
      file: { basename: 'fictional.jsonl', content },
    })
    expect(invoke).toHaveBeenCalledWith(TAURI_COMMANDS.importPickAndRead, {})
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('path')
  })

  it('rejects malformed native import DTOs and never reflects private fields', async () => {
    const base = {
      cancelled: false,
      file: {
        basename: 'fictional.txt',
        format: 'text',
        sizeBytes: 8,
        estimatedRecords: 1,
        secretFindings: 0,
        containsSecret: false,
        limits: {
          maxFileBytes: 25 * 1024 * 1024,
          maxRecords: 5_000,
          maxRecordBytes: 256 * 1024,
          maxJsonDepth: 32,
          maxRules: 100,
          maxRuleBytes: 256 * 1024,
        },
        content: 'ordinary',
      },
    }
    for (const response of [
      { cancelled: true, file: base.file },
      { ...base, path: '/Users/private/customer.txt' },
      { ...base, file: { ...base.file, path: '/Users/private/customer.txt' } },
      { ...base, file: { ...base.file, basename: '../customer.txt' } },
      { ...base, file: { ...base.file, sizeBytes: 9 } },
      { ...base, file: { ...base.file, containsSecret: true } },
      { ...base, file: { ...base.file, limits: { ...base.file.limits, maxFileBytes: 9 } } },
    ]) {
      const gateway = new TauriGateway(() => ({ invoke: async () => response }))
      const failure = await gateway.pickAndReadImport().catch((error: unknown) => error)
      expect(failure).toMatchObject({
        code: 'INVALID_RESPONSE',
        operation: 'import-native-file',
      })
      expect(JSON.stringify(failure)).not.toContain('/Users/private')
    }
  })

  it('turns native failures into allowlisted SafeError messages without paths or secrets', async () => {
    const privateDetail = '/Users/alice/Documents/customer-secret.json token=do-not-render'
    const progress: OperationProgress[] = []
    const gateway = new TauriGateway(() => ({
      invoke: async () => {
        throw new Error(privateDetail)
      },
    }))

    const failure = await gateway
      .getVaultStatus((next) => progress.push(next))
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(SafeError)
    expect(failure).toMatchObject({
      code: 'VAULT_STATUS_FAILED',
      operation: 'read-vault-status',
      retryable: true,
    })
    expect(JSON.stringify({ failure, progress })).not.toContain(privateDetail)
    expect(JSON.stringify({ failure, progress })).not.toContain('/Users/alice')
    expect(progress.map((item) => item.phase)).toEqual(['running', 'failed'])
  })

  it('maps native NOT_IMPLEMENTED to a safe fail-closed system verification error', async () => {
    const privateDetail = 'cancelled for /private/vault/customer-key.txt'
    const invoke = vi.fn(async () => {
      throw { code: 'NOT_IMPLEMENTED', message: privateDetail }
    })
    const gateway = new TauriGateway(() => ({
      invoke,
    }))

    const failure = await gateway.verifySystemIdentity().catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'COMMAND_UNAVAILABLE',
      operation: 'system-verification',
      message: '当前版本尚未提供所需的桌面安全能力。',
    })
    expect(invoke).toHaveBeenCalledWith(TAURI_COMMANDS.verifySystemIdentity, {})
    expect(JSON.stringify(failure)).not.toContain(privateDetail)
  })

  it('maps native authentication cancellation without exposing native details', async () => {
    const privateDetail = 'cancelled near /private/vault/customer-key.txt'
    const gateway = new TauriGateway(() => ({
      invoke: async () => {
        throw { code: 'AUTHENTICATION_CANCELLED', message: privateDetail }
      },
    }))

    const failure = await gateway.verifySystemIdentity().catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'SYSTEM_VERIFICATION_CANCELLED',
      operation: 'system-verification',
      message: '系统验证已取消，保险库仍处于锁定状态。',
    })
    expect(JSON.stringify(failure)).not.toContain(privateDetail)
  })

  it('fails closed when native status is malformed', async () => {
    const gateway = new TauriGateway(() => ({
      invoke: async () => ({ state: 'maybe', path: '/secret/path' }),
    }))

    const failure = await gateway.getVaultStatus().catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'INVALID_RESPONSE', operation: 'read-vault-status' })
    expect(JSON.stringify(failure)).not.toContain('/secret/path')
  })

  it('validates project envelopes and maps revision conflicts without native details', async () => {
    const malformed = new TauriGateway(() => ({
      invoke: async () => ({ revision: -1, schemaVersion: 0, project: '/private/data' }),
    }))
    await expect(malformed.readProject()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      operation: 'read-project',
    })

    const conflict = new TauriGateway(() => ({
      invoke: async () => {
        throw { code: 'REVISION_CONFLICT', message: '/private/vault' }
      },
    }))
    const failure = await conflict.writeProject(1, { version: 2 }).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'REVISION_CONFLICT',
      operation: 'write-project',
    })
    expect(JSON.stringify(failure)).not.toContain('/private/vault')
  })

  it('rejects missing, ambiguous, and future-version native project envelopes', async () => {
    for (const response of [
      { revision: 0, schemaVersion: 2 },
      { revision: 0, schemaVersion: 2, project: undefined },
      { revision: 0, schemaVersion: 2, project: [] },
      { revision: 0, schemaVersion: 3, project: null },
    ]) {
      const gateway = new TauriGateway(() => ({ invoke: async () => response }))
      await expect(gateway.readProject()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        operation: 'read-project',
      })
    }

    const explicitEmpty = new TauriGateway(() => ({
      invoke: async () => ({ revision: 0, schemaVersion: 2, project: null }),
    }))
    await expect(explicitEmpty.readProject()).resolves.toEqual({
      revision: 0,
      schemaVersion: 2,
      project: null,
    })
  })

  it('attributes malformed write and clear responses to their actual operations', async () => {
    const missingProject = new TauriGateway(() => ({
      invoke: async () => ({ revision: 1, schemaVersion: 2 }),
    }))
    await expect(missingProject.writeProject(0, { version: 2 })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      operation: 'write-project',
    })

    const nonNullClear = new TauriGateway(() => ({
      invoke: async () => ({ revision: 1, schemaVersion: 2, project: {} }),
    }))
    await expect(nonNullClear.clearProject(0)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      operation: 'clear-project',
    })
  })

  it('emits unified, clamped, and message-safe operation progress', async () => {
    const updates: OperationProgress[] = []
    await expect(
      runDesktopOperation(
        'initialize',
        async () => 'ready',
        (next) => updates.push(next),
      ),
    ).resolves.toBe('ready')
    expect(updates).toEqual([
      {
        operation: 'initialize',
        phase: 'running',
        percent: 10,
        message: '正在确认本地运行环境…',
        error: undefined,
      },
      {
        operation: 'initialize',
        phase: 'succeeded',
        percent: 100,
        message: '本地运行环境已就绪。',
        error: undefined,
      },
    ])

    const privateDetail = '/Users/private.txt password=hunter2'
    const sanitized = sanitizeOperationProgress({
      operation: 'system-verification',
      phase: 'failed',
      percent: 900,
      message: privateDetail,
      error: Object.assign(new Error(privateDetail), { code: 'SYSTEM_VERIFICATION_FAILED' }),
    })
    expect(sanitized.percent).toBe(100)
    expect(sanitized.message).toBe('系统验证未通过，保险库仍处于锁定状态。')
    expect(JSON.stringify(sanitized)).not.toContain(privateDetail)
  })

  it('reconstructs even mutated SafeError instances before exposing them', () => {
    const error = new SafeError('OPERATION_FAILED', 'initialize')
    error.message = '/private/customer-secret.txt'

    const safe = toSafeError(error, 'lock-vault')

    expect(safe.message).toBe('操作未完成，请重试。')
    expect(safe.operation).toBe('lock-vault')
    expect(JSON.stringify(safe)).not.toContain('/private/customer-secret.txt')
  })
})
