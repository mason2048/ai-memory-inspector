import type { DesktopGateway } from './contracts'
import { BrowserMvpGateway } from './browser-mvp-gateway'
import { readTauriInternals, TauriGateway } from './tauri-gateway'

export type {
  DesktopCapabilities,
  BackupOperationResult,
  DesktopGateway,
  DesktopOperation,
  DesktopRuntimeInfo,
  DesktopRuntimeKind,
  NativeImportFile,
  NativeImportFormat,
  NativeImportSecurityLimits,
  NativeImportSelection,
  OperationPhase,
  OperationProgress,
  OperationProgressListener,
  VaultState,
  VaultStatus,
} from './contracts'
export { BrowserMvpGateway } from './browser-mvp-gateway'
export { idleProgress, runDesktopOperation, sanitizeOperationProgress } from './operation'
export { SafeError, toSafeError } from './safe-error'
export type { SafeErrorCode } from './safe-error'
export { readTauriInternals, TAURI_COMMANDS, TauriGateway } from './tauri-gateway'
export type { TauriInternals } from './tauri-gateway'

export function createDesktopGateway(scope: unknown = globalThis): DesktopGateway {
  const resolveInternals = () => readTauriInternals(scope)
  if (isNativeDesktopTarget(scope)) return new TauriGateway(resolveInternals)
  return resolveInternals() ? new TauriGateway(resolveInternals) : new BrowserMvpGateway()
}

/**
 * Tauri injects this build-time metadata object independently of the invoke
 * bridge. A packaged desktop build therefore fails closed when invoke is
 * missing instead of silently switching to plaintext browser persistence.
 */
export function isNativeDesktopTarget(scope: unknown = globalThis): boolean {
  if (!scope || (typeof scope !== 'object' && typeof scope !== 'function')) return false
  try {
    return Object.prototype.hasOwnProperty.call(scope, '__TAURI_INTERNALS__') ||
      Object.prototype.hasOwnProperty.call(scope, '__TAURI_METADATA__')
  } catch {
    return false
  }
}
