import type { DesktopOperation, OperationProgress, OperationProgressListener } from './contracts'
import { toSafeError } from './safe-error'

const runningMessages: Record<DesktopOperation, string> = {
  initialize: '正在确认本地运行环境…',
  'read-vault-status': '正在确认保险库状态…',
  'system-verification': '正在等待系统验证…',
  'lock-vault': '正在锁定本地保险库…',
  'read-project': '正在读取加密项目…',
  'write-project': '正在保存加密项目…',
  'clear-project': '正在清除加密项目…',
  'import-native-file': '正在选择并安全预检本地文件…',
  'export-backup': '正在创建完整加密备份…',
  'restore-backup': '正在验证并恢复加密备份…',
}

const succeededMessages: Record<DesktopOperation, string> = {
  initialize: '本地运行环境已就绪。',
  'read-vault-status': '保险库状态已确认。',
  'system-verification': '系统验证已完成。',
  'lock-vault': '本地保险库已锁定。',
  'read-project': '加密项目已读取。',
  'write-project': '加密项目已保存。',
  'clear-project': '加密项目已清除。',
  'import-native-file': '本地文件已完成安全预检。',
  'export-backup': '完整加密备份已创建。',
  'restore-backup': '加密备份已验证并恢复。',
}

export function idleProgress(operation: DesktopOperation = 'initialize'): OperationProgress {
  return { operation, phase: 'idle', percent: 0, message: '' }
}

export function sanitizeOperationProgress(progress: OperationProgress): OperationProgress {
  const percent = Number.isFinite(progress.percent)
    ? Math.max(0, Math.min(100, progress.percent))
    : 0
  if (progress.phase === 'failed') {
    const error = toSafeError(progress.error, progress.operation)
    return { ...progress, percent, message: error.message, error }
  }
  return {
    ...progress,
    percent,
    message:
      progress.phase === 'succeeded'
        ? succeededMessages[progress.operation]
        : progress.phase === 'running'
          ? runningMessages[progress.operation]
          : '',
    error: undefined,
  }
}

export async function runDesktopOperation<T>(
  operation: DesktopOperation,
  action: () => Promise<T>,
  onProgress?: OperationProgressListener,
): Promise<T> {
  onProgress?.(
    sanitizeOperationProgress({
      operation,
      phase: 'running',
      percent: 10,
      message: runningMessages[operation],
    }),
  )

  try {
    const result = await action()
    onProgress?.(
      sanitizeOperationProgress({
        operation,
        phase: 'succeeded',
        percent: 100,
        message: succeededMessages[operation],
      }),
    )
    return result
  } catch (error) {
    const safeError = toSafeError(error, operation)
    onProgress?.(
      sanitizeOperationProgress({
        operation,
        phase: 'failed',
        percent: 100,
        message: safeError.message,
        error: safeError,
      }),
    )
    throw safeError
  }
}
