import type {
  DesktopGateway,
  DesktopRuntimeInfo,
  NativeProjectEnvelope,
  NativeImportSelection,
  OperationProgressListener,
  BackupOperationResult,
  VaultStatus,
} from './contracts'
import { runDesktopOperation } from './operation'
import { SafeError } from './safe-error'

const browserRuntime: DesktopRuntimeInfo = {
  kind: 'browser-mvp',
  label: '浏览器本地 MVP',
  capabilities: {
    nativeVault: false,
    nativeFileImport: false,
    systemVerification: false,
    localOnly: true,
  },
  privacyBoundary: '数据只由当前浏览器页面处理；浏览器存储不等同于操作系统保险库。',
}

const browserVault: VaultStatus = { state: 'unavailable' }

export class BrowserMvpGateway implements DesktopGateway {
  readonly kind = 'browser-mvp' as const

  async getRuntimeInfo(): Promise<DesktopRuntimeInfo> {
    return browserRuntime
  }

  async getVaultStatus(onProgress?: OperationProgressListener): Promise<VaultStatus> {
    return runDesktopOperation('read-vault-status', async () => browserVault, onProgress)
  }

  async verifySystemIdentity(onProgress?: OperationProgressListener): Promise<VaultStatus> {
    return runDesktopOperation(
      'system-verification',
      async () => {
        throw new SafeError('COMMAND_UNAVAILABLE', 'system-verification')
      },
      onProgress,
    )
  }

  async lockVault(onProgress?: OperationProgressListener): Promise<VaultStatus> {
    return runDesktopOperation(
      'lock-vault',
      async () => {
        throw new SafeError('COMMAND_UNAVAILABLE', 'lock-vault')
      },
      onProgress,
    )
  }

  async readProject<T>(): Promise<NativeProjectEnvelope<T>> {
    throw new SafeError('COMMAND_UNAVAILABLE', 'read-project')
  }

  async writeProject<T>(_expectedRevision: number, _project: T): Promise<NativeProjectEnvelope<T>> {
    throw new SafeError('COMMAND_UNAVAILABLE', 'write-project')
  }

  async clearProject(_expectedRevision: number): Promise<NativeProjectEnvelope<never>> {
    throw new SafeError('COMMAND_UNAVAILABLE', 'clear-project')
  }

  async pickAndReadImport(
    onProgress?: OperationProgressListener,
  ): Promise<NativeImportSelection> {
    return runDesktopOperation(
      'import-native-file',
      async () => {
        throw new SafeError('COMMAND_UNAVAILABLE', 'import-native-file')
      },
      onProgress,
    )
  }

  async exportBackup(_passphrase: string): Promise<BackupOperationResult> {
    throw new SafeError('COMMAND_UNAVAILABLE', 'export-backup')
  }

  async restoreBackup(_passphrase: string): Promise<BackupOperationResult> {
    throw new SafeError('COMMAND_UNAVAILABLE', 'restore-backup')
  }

}
