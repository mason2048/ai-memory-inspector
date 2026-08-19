import type { DesktopOperation } from './contracts'

export type SafeErrorCode =
  | 'RUNTIME_UNAVAILABLE'
  | 'COMMAND_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'SYSTEM_VERIFICATION_CANCELLED'
  | 'SYSTEM_VERIFICATION_FAILED'
  | 'VAULT_STATUS_FAILED'
  | 'VAULT_LOCK_FAILED'
  | 'PROJECT_READ_FAILED'
  | 'PROJECT_WRITE_FAILED'
  | 'PROJECT_CLEAR_FAILED'
  | 'IMPORT_FILE_FAILED'
  | 'REVISION_CONFLICT'
  | 'BACKUP_EXPORT_FAILED'
  | 'BACKUP_RESTORE_FAILED'
  | 'OPERATION_FAILED'

const safeMessages: Record<SafeErrorCode, string> = {
  RUNTIME_UNAVAILABLE: '桌面安全能力暂时不可用，请重新打开应用后重试。',
  COMMAND_UNAVAILABLE: '当前版本尚未提供所需的桌面安全能力。',
  INVALID_RESPONSE: '桌面安全状态无法确认，已保持锁定。',
  SYSTEM_VERIFICATION_CANCELLED: '系统验证已取消，保险库仍处于锁定状态。',
  SYSTEM_VERIFICATION_FAILED: '系统验证未通过，保险库仍处于锁定状态。',
  VAULT_STATUS_FAILED: '无法确认保险库状态，已保持锁定。',
  VAULT_LOCK_FAILED: '无法确认保险库已锁定，请关闭应用后重试。',
  PROJECT_READ_FAILED: '无法读取加密项目，保险库已保持当前状态。',
  PROJECT_WRITE_FAILED: '无法保存加密项目，请重新载入后重试。',
  PROJECT_CLEAR_FAILED: '无法确认加密项目已清除，请勿继续写入。',
  IMPORT_FILE_FAILED: '所选文件未通过本地安全预检，未导入任何内容。',
  REVISION_CONFLICT: '项目已被另一操作更新，请重新载入后再保存。',
  BACKUP_EXPORT_FAILED: '完整加密备份未能创建，现有资料库没有变化。',
  BACKUP_RESTORE_FAILED: '加密备份未通过验证或无法恢复，现有资料库没有变化。',
  OPERATION_FAILED: '操作未完成，请重试。',
}

const retryableCodes = new Set<SafeErrorCode>([
  'RUNTIME_UNAVAILABLE',
  'SYSTEM_VERIFICATION_CANCELLED',
  'SYSTEM_VERIFICATION_FAILED',
  'VAULT_STATUS_FAILED',
  'VAULT_LOCK_FAILED',
  'PROJECT_READ_FAILED',
  'PROJECT_WRITE_FAILED',
  'PROJECT_CLEAR_FAILED',
  'IMPORT_FILE_FAILED',
  'REVISION_CONFLICT',
  'BACKUP_EXPORT_FAILED',
  'BACKUP_RESTORE_FAILED',
  'OPERATION_FAILED',
])

const knownCodes = new Set<SafeErrorCode>(Object.keys(safeMessages) as SafeErrorCode[])

/**
 * Error safe for rendering and serialization. The original exception is never
 * retained, so native paths, account names, credentials, and memory content
 * cannot leak through `message`, `cause`, or JSON output.
 */
export class SafeError extends Error {
  readonly name = 'SafeError'
  readonly code: SafeErrorCode
  readonly operation: DesktopOperation
  readonly retryable: boolean

  constructor(code: SafeErrorCode, operation: DesktopOperation) {
    super(safeMessages[code])
    this.code = code
    this.operation = operation
    this.retryable = retryableCodes.has(code)
    this.stack = undefined
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      operation: this.operation,
      retryable: this.retryable,
      message: this.message,
    }
  }
}

function readAllowlistedCode(error: unknown): SafeErrorCode | undefined {
  if (!error || typeof error !== 'object') return undefined
  try {
    const candidate = (error as { code?: unknown }).code
    if (typeof candidate !== 'string') return undefined
    if (knownCodes.has(candidate as SafeErrorCode)) return candidate as SafeErrorCode
    if (candidate === 'NOT_IMPLEMENTED') return 'COMMAND_UNAVAILABLE'
    if (candidate === 'AUTHENTICATION_CANCELLED' || candidate === 'USER_CANCELLED')
      return 'SYSTEM_VERIFICATION_CANCELLED'
    if (candidate === 'AUTHENTICATION_FAILED') return 'SYSTEM_VERIFICATION_FAILED'
    if (candidate === 'REVISION_CONFLICT') return 'REVISION_CONFLICT'
    return undefined
  } catch {
    return undefined
  }
}

const fallbackCode: Record<DesktopOperation, SafeErrorCode> = {
  initialize: 'RUNTIME_UNAVAILABLE',
  'read-vault-status': 'VAULT_STATUS_FAILED',
  'system-verification': 'SYSTEM_VERIFICATION_FAILED',
  'lock-vault': 'VAULT_LOCK_FAILED',
  'read-project': 'PROJECT_READ_FAILED',
  'write-project': 'PROJECT_WRITE_FAILED',
  'clear-project': 'PROJECT_CLEAR_FAILED',
  'import-native-file': 'IMPORT_FILE_FAILED',
  'export-backup': 'BACKUP_EXPORT_FAILED',
  'restore-backup': 'BACKUP_RESTORE_FAILED',
}

export function toSafeError(error: unknown, operation: DesktopOperation): SafeError {
  if (error instanceof SafeError) return new SafeError(error.code, operation)
  return new SafeError(
    readAllowlistedCode(error) ?? fallbackCode[operation] ?? 'OPERATION_FAILED',
    operation,
  )
}
