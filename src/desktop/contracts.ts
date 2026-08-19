import type { SafeError } from './safe-error'

export type DesktopRuntimeKind = 'browser-mvp' | 'tauri'
export type VaultState = 'unavailable' | 'locked' | 'unlocked'
export type DesktopOperation =
  | 'initialize'
  | 'read-vault-status'
  | 'system-verification'
  | 'lock-vault'
  | 'read-project'
  | 'write-project'
  | 'clear-project'
  | 'import-native-file'
  | 'export-backup'
  | 'restore-backup'
export type OperationPhase = 'idle' | 'running' | 'succeeded' | 'failed'

export interface DesktopCapabilities {
  nativeVault: boolean
  nativeFileImport: boolean
  systemVerification: boolean
  localOnly: true
}

export interface DesktopRuntimeInfo {
  kind: DesktopRuntimeKind
  label: string
  capabilities: DesktopCapabilities
  privacyBoundary: string
}

export interface VaultStatus {
  state: VaultState
  /** A non-sensitive display timestamp supplied by the native boundary. */
  changedAt?: string
}

export interface NativeProjectEnvelope<T = unknown> {
  revision: number
  schemaVersion: number
  project: T | null
}

export interface BackupOperationResult {
  completed: boolean
  cancelled: boolean
  revision: number
  schemaVersion: number
}

export type NativeImportFormat = 'markdown' | 'text' | 'json' | 'jsonl' | 'ndjson'

export interface NativeImportSecurityLimits {
  maxFileBytes: number
  maxRecords: number
  maxRecordBytes: number
  maxJsonDepth: number
  maxRules: number
  maxRuleBytes: number
}

export interface NativeImportFile {
  basename: string
  format: NativeImportFormat
  sizeBytes: number
  estimatedRecords: number
  secretFindings: number
  containsSecret: boolean
  limits: NativeImportSecurityLimits
  content: string
}

export type NativeImportSelection =
  | { cancelled: true }
  | { cancelled: false; file: NativeImportFile }

export interface OperationProgress {
  operation: DesktopOperation
  phase: OperationPhase
  percent: number
  message: string
  error?: SafeError
}

export type OperationProgressListener = (progress: OperationProgress) => void

/**
 * Production boundary for browser and desktop runtimes. No method accepts a
 * file-system path. The native import command accepts no renderer arguments
 * and returns only the user-authorized file content plus bounded metadata.
 */
export interface DesktopGateway {
  readonly kind: DesktopRuntimeKind
  getRuntimeInfo(): Promise<DesktopRuntimeInfo>
  getVaultStatus(onProgress?: OperationProgressListener): Promise<VaultStatus>
  verifySystemIdentity(onProgress?: OperationProgressListener): Promise<VaultStatus>
  lockVault(onProgress?: OperationProgressListener): Promise<VaultStatus>
  readProject<T = unknown>(): Promise<NativeProjectEnvelope<T>>
  writeProject<T = unknown>(expectedRevision: number, project: T): Promise<NativeProjectEnvelope<T>>
  clearProject(expectedRevision: number): Promise<NativeProjectEnvelope<never>>
  pickAndReadImport(onProgress?: OperationProgressListener): Promise<NativeImportSelection>
  exportBackup(passphrase: string): Promise<BackupOperationResult>
  restoreBackup(passphrase: string): Promise<BackupOperationResult>
}
