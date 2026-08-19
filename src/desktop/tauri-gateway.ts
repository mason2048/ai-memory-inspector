import type {
  DesktopGateway,
  BackupOperationResult,
  DesktopRuntimeInfo,
  NativeImportFile,
  NativeImportFormat,
  NativeImportSecurityLimits,
  NativeImportSelection,
  NativeProjectEnvelope,
  OperationProgressListener,
  VaultState,
  VaultStatus,
} from './contracts'
import { runDesktopOperation } from './operation'
import { SafeError, toSafeError } from './safe-error'

export const TAURI_COMMANDS = {
  vaultStatus: 'memory_inspector_vault_status',
  verifySystemIdentity: 'memory_inspector_vault_unlock_with_system',
  lockVault: 'memory_inspector_vault_lock',
  projectRead: 'memory_inspector_project_read',
  projectWrite: 'memory_inspector_project_write',
  projectClear: 'memory_inspector_project_clear',
  backupExport: 'memory_inspector_backup_export',
  backupRestore: 'memory_inspector_backup_restore',
  importPickAndRead: 'memory_inspector_import_pick_and_read',
} as const

/** Must stay aligned with `vault::CURRENT_SCHEMA_VERSION` in the native core. */
export const NATIVE_VAULT_SCHEMA_VERSION = 2

export interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

type TauriScope = {
  __TAURI_INTERNALS__?: unknown
}

function asScope(scope: unknown): TauriScope | undefined {
  return scope !== null && (typeof scope === 'object' || typeof scope === 'function')
    ? (scope as TauriScope)
    : undefined
}

/** Dynamically reads Tauri globals without importing a Tauri JavaScript package. */
export function readTauriInternals(scope: unknown = globalThis): TauriInternals | undefined {
  try {
    const candidate = asScope(scope)?.__TAURI_INTERNALS__
    if (!candidate || typeof candidate !== 'object') return undefined
    const invoke = (candidate as { invoke?: unknown }).invoke
    if (typeof invoke !== 'function') return undefined
    return {
      invoke: <T>(command: string, args?: Record<string, unknown>) =>
        Reflect.apply(invoke, candidate, [command, args]) as Promise<T>,
    }
  } catch {
    return undefined
  }
}

function parseVaultStatus(
  value: unknown,
  operation: 'read-vault-status' | 'system-verification' | 'lock-vault',
): VaultStatus {
  if (!value || typeof value !== 'object') {
    throw new SafeError('INVALID_RESPONSE', operation)
  }
  const { state, changedAt } = value as { state?: unknown; changedAt?: unknown }
  if (state !== 'locked' && state !== 'unlocked') {
    throw new SafeError('INVALID_RESPONSE', operation)
  }
  return {
    state: state as VaultState,
    ...(typeof changedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(changedAt)
      ? { changedAt }
      : {}),
  }
}

function parseProjectEnvelope<T>(
  value: unknown,
  operation: 'read-project' | 'write-project' | 'clear-project',
  expectedProject: 'nullable-object' | 'object' | 'null',
): NativeProjectEnvelope<T> {
  if (!value || typeof value !== 'object') {
    throw new SafeError('INVALID_RESPONSE', operation)
  }
  const envelope = value as Record<string, unknown>
  const { revision, schemaVersion, project } = envelope
  const hasProject = Object.prototype.hasOwnProperty.call(envelope, 'project')
  const projectIsObject = project !== null && typeof project === 'object' && !Array.isArray(project)
  const projectMatches =
    expectedProject === 'null'
      ? project === null
      : expectedProject === 'object'
        ? projectIsObject
        : project === null || projectIsObject
  if (
    !Number.isSafeInteger(revision) ||
    (revision as number) < 0 ||
    schemaVersion !== NATIVE_VAULT_SCHEMA_VERSION ||
    !hasProject ||
    !projectMatches
  ) {
    throw new SafeError('INVALID_RESPONSE', operation)
  }
  return {
    revision: revision as number,
    schemaVersion: NATIVE_VAULT_SCHEMA_VERSION,
    project: project as T | null,
  }
}

function parseBackupResult(
  value: unknown,
  operation: 'export-backup' | 'restore-backup',
): BackupOperationResult {
  if (!value || typeof value !== 'object') throw new SafeError('INVALID_RESPONSE', operation)
  const { completed, cancelled, revision, schemaVersion } = value as Record<string, unknown>
  if (
    typeof completed !== 'boolean' ||
    typeof cancelled !== 'boolean' ||
    completed === cancelled ||
    !Number.isSafeInteger(revision) ||
    (revision as number) < 0 ||
    schemaVersion !== NATIVE_VAULT_SCHEMA_VERSION
  ) {
    throw new SafeError('INVALID_RESPONSE', operation)
  }
  return {
    completed,
    cancelled,
    revision: revision as number,
    schemaVersion: NATIVE_VAULT_SCHEMA_VERSION,
  }
}

const nativeImportFormats = new Set<NativeImportFormat>([
  'markdown',
  'text',
  'json',
  'jsonl',
  'ndjson',
])
const nativeImportFileKeys = new Set([
  'basename',
  'format',
  'sizeBytes',
  'estimatedRecords',
  'secretFindings',
  'containsSecret',
  'limits',
  'content',
])
const nativeImportLimitKeys = new Set([
  'maxFileBytes',
  'maxRecords',
  'maxRecordBytes',
  'maxJsonDepth',
  'maxRules',
  'maxRuleBytes',
])

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function utf8ByteLength(value: string): number | undefined {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x7f) bytes += 1
    else if (codeUnit <= 0x7ff) bytes += 2
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (low < 0xdc00 || low > 0xdfff) return undefined
      bytes += 4
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return undefined
    else bytes += 3
  }
  return bytes
}

function parseNativeImportLimits(value: unknown): NativeImportSecurityLimits | undefined {
  if (!value || typeof value !== 'object') return undefined
  const limits = value as Record<string, unknown>
  if (!hasOnlyKeys(limits, nativeImportLimitKeys) || Object.keys(limits).length !== 6)
    return undefined
  const {
    maxFileBytes,
    maxRecords,
    maxRecordBytes,
    maxJsonDepth,
    maxRules,
    maxRuleBytes,
  } = limits
  if (
    !isNonNegativeSafeInteger(maxFileBytes) ||
    !isNonNegativeSafeInteger(maxRecords) ||
    !isNonNegativeSafeInteger(maxRecordBytes) ||
    !isNonNegativeSafeInteger(maxJsonDepth) ||
    !isNonNegativeSafeInteger(maxRules) ||
    !isNonNegativeSafeInteger(maxRuleBytes) ||
    maxFileBytes !== 25 * 1024 * 1024 ||
    maxRecords !== 5_000 ||
    maxRecordBytes !== 256 * 1024 ||
    maxJsonDepth !== 32
  )
    return undefined
  return {
    maxFileBytes,
    maxRecords,
    maxRecordBytes,
    maxJsonDepth,
    maxRules,
    maxRuleBytes,
  }
}

function parseNativeImportFile(value: unknown): NativeImportFile | undefined {
  if (!value || typeof value !== 'object') return undefined
  const file = value as Record<string, unknown>
  if (!hasOnlyKeys(file, nativeImportFileKeys) || Object.keys(file).length !== 8) return undefined
  const {
    basename,
    format,
    sizeBytes,
    estimatedRecords,
    secretFindings,
    containsSecret,
    limits: rawLimits,
    content,
  } = file
  const limits = parseNativeImportLimits(rawLimits)
  const contentBytes = typeof content === 'string' ? utf8ByteLength(content) : undefined
  if (
    typeof basename !== 'string' ||
    !basename ||
    basename === '.' ||
    basename === '..' ||
    /[\\/\0\r\n]/.test(basename) ||
    typeof format !== 'string' ||
    !nativeImportFormats.has(format as NativeImportFormat) ||
    !isNonNegativeSafeInteger(sizeBytes) ||
    !isNonNegativeSafeInteger(estimatedRecords) ||
    estimatedRecords < 1 ||
    !isNonNegativeSafeInteger(secretFindings) ||
    typeof containsSecret !== 'boolean' ||
    containsSecret !== (secretFindings > 0) ||
    !limits ||
    sizeBytes > limits.maxFileBytes ||
    estimatedRecords > limits.maxRecords ||
    contentBytes !== sizeBytes
  )
    return undefined
  return {
    basename,
    format: format as NativeImportFormat,
    sizeBytes,
    estimatedRecords,
    secretFindings,
    containsSecret,
    limits,
    content: content as string,
  }
}

function parseNativeImportSelection(value: unknown): NativeImportSelection {
  if (!value || typeof value !== 'object')
    throw new SafeError('INVALID_RESPONSE', 'import-native-file')
  const response = value as Record<string, unknown>
  if (response.cancelled === true && Object.keys(response).length === 1)
    return { cancelled: true }
  if (
    response.cancelled === false &&
    Object.keys(response).length === 2 &&
    Object.prototype.hasOwnProperty.call(response, 'file')
  ) {
    const file = parseNativeImportFile(response.file)
    if (file) return { cancelled: false, file }
  }
  throw new SafeError('INVALID_RESPONSE', 'import-native-file')
}

const tauriRuntime: DesktopRuntimeInfo = {
  kind: 'tauri',
  label: '受保护的桌面应用',
  capabilities: {
    nativeVault: true,
    nativeFileImport: true,
    systemVerification: true,
    localOnly: true,
  },
  privacyBoundary:
    '桌面保险库仅保存在本机；主密钥由 macOS 钥匙串在系统验证成功后释放，应用不会读取、保存或上传系统密码。',
}

export class TauriGateway implements DesktopGateway {
  readonly kind = 'tauri' as const
  private readonly resolveInternals: () => TauriInternals | undefined

  constructor(resolveInternals: () => TauriInternals | undefined = () => readTauriInternals()) {
    this.resolveInternals = resolveInternals
  }

  async getRuntimeInfo(): Promise<DesktopRuntimeInfo> {
    if (!this.resolveInternals()) throw new SafeError('RUNTIME_UNAVAILABLE', 'initialize')
    return tauriRuntime
  }

  async getVaultStatus(onProgress?: OperationProgressListener): Promise<VaultStatus> {
    return runDesktopOperation(
      'read-vault-status',
      async () => {
        const value = await this.invoke<unknown>(TAURI_COMMANDS.vaultStatus)
        return parseVaultStatus(value, 'read-vault-status')
      },
      onProgress,
    )
  }

  async verifySystemIdentity(onProgress?: OperationProgressListener): Promise<VaultStatus> {
    return runDesktopOperation(
      'system-verification',
      async () => {
        const value = await this.invoke<unknown>(TAURI_COMMANDS.verifySystemIdentity)
        const status = parseVaultStatus(value, 'system-verification')
        if (status.state !== 'unlocked')
          throw new SafeError('SYSTEM_VERIFICATION_FAILED', 'system-verification')
        return status
      },
      onProgress,
    )
  }

  async lockVault(onProgress?: OperationProgressListener): Promise<VaultStatus> {
    return runDesktopOperation(
      'lock-vault',
      async () => {
        const value = await this.invoke<unknown>(TAURI_COMMANDS.lockVault)
        const status = parseVaultStatus(value, 'lock-vault')
        if (status.state !== 'locked') throw new SafeError('VAULT_LOCK_FAILED', 'lock-vault')
        return status
      },
      onProgress,
    )
  }

  async readProject<T>(): Promise<NativeProjectEnvelope<T>> {
    try {
      return parseProjectEnvelope<T>(
        await this.invoke<unknown>(TAURI_COMMANDS.projectRead),
        'read-project',
        'nullable-object',
      )
    } catch (error) {
      throw toSafeError(error, 'read-project')
    }
  }

  async writeProject<T>(expectedRevision: number, project: T): Promise<NativeProjectEnvelope<T>> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new SafeError('INVALID_RESPONSE', 'write-project')
    }
    try {
      const internals = this.resolveInternals()
      if (!internals) throw new SafeError('RUNTIME_UNAVAILABLE', 'initialize')
      return parseProjectEnvelope<T>(
        await internals.invoke<unknown>(TAURI_COMMANDS.projectWrite, {
          request: { expectedRevision, project },
        }),
        'write-project',
        'object',
      )
    } catch (error) {
      throw toSafeError(error, 'write-project')
    }
  }

  async clearProject(expectedRevision: number): Promise<NativeProjectEnvelope<never>> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new SafeError('INVALID_RESPONSE', 'clear-project')
    }
    try {
      const internals = this.resolveInternals()
      if (!internals) throw new SafeError('RUNTIME_UNAVAILABLE', 'initialize')
      return parseProjectEnvelope<never>(
        await internals.invoke<unknown>(TAURI_COMMANDS.projectClear, {
          request: { expectedRevision },
        }),
        'clear-project',
        'null',
      )
    } catch (error) {
      throw toSafeError(error, 'clear-project')
    }
  }

  async pickAndReadImport(
    onProgress?: OperationProgressListener,
  ): Promise<NativeImportSelection> {
    return runDesktopOperation(
      'import-native-file',
      async () =>
        parseNativeImportSelection(
          await this.invoke<unknown>(TAURI_COMMANDS.importPickAndRead),
        ),
      onProgress,
    )
  }

  async exportBackup(passphrase: string): Promise<BackupOperationResult> {
    return this.runBackup('export-backup', TAURI_COMMANDS.backupExport, passphrase)
  }

  async restoreBackup(passphrase: string): Promise<BackupOperationResult> {
    return this.runBackup('restore-backup', TAURI_COMMANDS.backupRestore, passphrase)
  }

  private async runBackup(
    operation: 'export-backup' | 'restore-backup',
    command: string,
    passphrase: string,
  ): Promise<BackupOperationResult> {
    if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) {
      throw new SafeError(
        operation === 'export-backup' ? 'BACKUP_EXPORT_FAILED' : 'BACKUP_RESTORE_FAILED',
        operation,
      )
    }
    try {
      const internals = this.resolveInternals()
      if (!internals) throw new SafeError('RUNTIME_UNAVAILABLE', 'initialize')
      return parseBackupResult(await internals.invoke(command, { request: { passphrase } }), operation)
    } catch (error) {
      throw toSafeError(error, operation)
    }
  }

  private async invoke<T>(command: string): Promise<T> {
    const internals = this.resolveInternals()
    if (!internals) throw new SafeError('RUNTIME_UNAVAILABLE', 'initialize')
    return internals.invoke<T>(command, {})
  }
}
