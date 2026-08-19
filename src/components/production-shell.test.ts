import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopGateway, DesktopRuntimeInfo, VaultStatus } from '../desktop/contracts'
import { SafeError } from '../desktop/safe-error'
import {
  ProductionEmptyBoundary,
  ProductionErrorBoundary,
  ProductionLoadingBoundary,
  ProductionReadyShell,
  ProductionShell,
} from './ProductionShell'
import {
  lockVaultSafely,
  startVaultAutoLock,
  VAULT_AUTO_LOCK_MS,
  VaultGate,
  verifyVaultSafely,
} from './VaultGate'
import { ImportDialog } from './ImportDialog'
import { IMPORT_FILE_ACCEPT, IMPORT_FORMAT_LABELS } from '../stream-importer'

const browserRuntime: DesktopRuntimeInfo = {
  kind: 'browser-mvp',
  label: '浏览器本地 MVP',
  capabilities: {
    nativeVault: false,
    nativeFileImport: false,
    systemVerification: false,
    localOnly: true,
  },
  privacyBoundary: '浏览器边界',
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
  privacyBoundary: '系统验证只确认当前设备用户。',
}

function gateway(
  runtime: DesktopRuntimeInfo,
  status: VaultStatus,
  failures: Partial<Record<'verify' | 'lock', unknown>> = {},
): DesktopGateway {
  return {
    kind: runtime.kind,
    getRuntimeInfo: async () => runtime,
    getVaultStatus: async () => status,
    verifySystemIdentity: async () => {
      if (failures.verify) throw failures.verify
      return { state: 'unlocked' }
    },
    lockVault: async () => {
      if (failures.lock) throw failures.lock
      return { state: 'locked' }
    },
    readProject: async () => ({ revision: 0, schemaVersion: 2, project: null }),
    writeProject: async (_revision, project) => ({
      revision: 1,
      schemaVersion: 2,
      project,
    }),
    clearProject: async () => ({ revision: 1, schemaVersion: 2, project: null }),
    pickAndReadImport: async () => ({ cancelled: true }),
    exportBackup: async () => ({
      completed: true,
      cancelled: false,
      revision: 0,
      schemaVersion: 2,
    }),
    restoreBackup: async () => ({
      completed: true,
      cancelled: false,
      revision: 1,
      schemaVersion: 2,
    }),
  }
}

const child = (text: string) => createElement('div', null, text)

describe('production UI boundaries', () => {
  it('uses only the native chooser in desktop import mode and keeps File API in web mode', () => {
    const props = {
      pasteText: '',
      error: '',
      progress: null,
      onPasteChange: () => undefined,
      onFile: () => undefined,
      onNativeFile: () => undefined,
      onPaste: () => undefined,
      onCancel: () => undefined,
      onAbort: () => undefined,
    }
    const nativeHtml = renderToStaticMarkup(
      createElement(ImportDialog, { ...props, nativeFilePicker: true }),
    )
    const webHtml = renderToStaticMarkup(
      createElement(ImportDialog, { ...props, nativeFilePicker: false }),
    )

    expect(nativeHtml).toContain('使用系统窗口选择文件')
    expect(nativeHtml).toContain('不接收绝对路径')
    expect(nativeHtml).not.toContain('type="file"')
    expect(nativeHtml).not.toContain('拖拽文件到此处')
    expect(webHtml).toContain('type="file"')
    expect(webHtml).toContain('拖拽文件到此处')
    expect(webHtml).toContain(`accept="${IMPORT_FILE_ACCEPT}"`)
    for (const label of IMPORT_FORMAT_LABELS) {
      expect(nativeHtml).toContain(label)
      expect(webHtml).toContain(label)
    }
  })

  it('renders an explicit browser privacy boundary while preserving legacy child content', () => {
    const browser = gateway(browserRuntime, { state: 'unavailable' })
    const html = renderToStaticMarkup(
      createElement(VaultGate, {
        gateway: browser,
        runtime: browserRuntime,
        initialStatus: { state: 'unavailable' },
        children: child('旧版记忆检查工作区'),
      }),
    )

    expect(html).toContain('浏览器本地模式')
    expect(html).toContain('没有系统保险库或系统身份验证')
    expect(html).toContain('旧版记忆检查工作区')
  })

  it('keeps legacy content hidden while the desktop vault is locked', () => {
    const desktop = gateway(tauriRuntime, { state: 'locked' })
    const html = renderToStaticMarkup(
      createElement(VaultGate, {
        gateway: desktop,
        runtime: tauriRuntime,
        initialStatus: { state: 'locked' },
        children: child('不得在锁定时出现的记忆内容'),
      }),
    )

    expect(html).toContain('本地保险库已锁定')
    expect(html).toContain('使用系统验证解锁')
    expect(html).toContain('不会接收系统密码')
    expect(html).not.toContain('不得在锁定时出现的记忆内容')
  })

  it('renders a fail-closed production blocker when native system verification is unavailable', () => {
    const blockedRuntime: DesktopRuntimeInfo = {
      ...tauriRuntime,
      capabilities: { ...tauriRuntime.capabilities, systemVerification: false },
    }
    const desktop = gateway(blockedRuntime, { state: 'locked' })
    const html = renderToStaticMarkup(
      createElement(VaultGate, {
        gateway: desktop,
        runtime: blockedRuntime,
        initialStatus: { state: 'locked' },
        children: child('不得显示'),
      }),
    )

    expect(html).toContain('系统解锁尚未实现')
    expect(html).toContain('生产阻断')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('不得显示')
  })

  it('does not expose legacy content until the unlocked native project is loaded', () => {
    const desktop = gateway(tauriRuntime, { state: 'unlocked' })
    const html = renderToStaticMarkup(
      createElement(VaultGate, {
        gateway: desktop,
        runtime: tauriRuntime,
        initialStatus: { state: 'unlocked' },
        children: child('已解锁工作区'),
      }),
    )

    expect(html).toContain('正在读取加密项目')
    expect(html).not.toContain('已解锁工作区')
  })

  it('renders loading, retryable error, and empty workspace boundaries', () => {
    const loading = renderToStaticMarkup(
      createElement(ProductionLoadingBoundary, {
        progress: {
          operation: 'initialize',
          phase: 'running',
          percent: 10,
          message: '正在确认本地运行环境…',
        },
      }),
    )
    const error = renderToStaticMarkup(
      createElement(ProductionErrorBoundary, {
        error: new SafeError('RUNTIME_UNAVAILABLE', 'initialize'),
        onRetry: () => undefined,
      }),
    )
    const empty = renderToStaticMarkup(createElement(ProductionEmptyBoundary))

    expect(loading).toContain('正在打开本地工作区')
    expect(loading).toContain('<progress')
    expect(error).toContain('本地安全环境尚未就绪')
    expect(error).toContain('重试初始化')
    expect(error).toContain('不会显示文件路径')
    expect(empty).toContain('工作区尚未加载')
  })

  it('re-sanitizes mutated boundary errors and arbitrary progress messages at render time', () => {
    const privateDetail = '/Users/alice/private-memory.json token=never-render'
    const error = new SafeError('RUNTIME_UNAVAILABLE', 'initialize')
    error.message = privateDetail
    const errorHtml = renderToStaticMarkup(
      createElement(ProductionErrorBoundary, { error, onRetry: () => undefined }),
    )
    const loadingHtml = renderToStaticMarkup(
      createElement(ProductionLoadingBoundary, {
        progress: {
          operation: 'initialize',
          phase: 'running',
          percent: 50,
          message: privateDetail,
        },
      }),
    )

    expect(`${errorHtml}${loadingHtml}`).not.toContain(privateDetail)
    expect(errorHtml).toContain('桌面安全能力暂时不可用')
    expect(loadingHtml).toContain('正在确认本地运行环境')
  })

  it('renders CSP-compatible markup without inline styles', () => {
    const browser = gateway(browserRuntime, { state: 'unavailable' })
    const desktop = gateway(tauriRuntime, { state: 'locked' })
    const html = [
      renderToStaticMarkup(
        createElement(ProductionLoadingBoundary, {
          progress: { operation: 'initialize', phase: 'running', percent: 50, message: 'loading' },
        }),
      ),
      renderToStaticMarkup(
        createElement(VaultGate, {
          gateway: browser,
          runtime: browserRuntime,
          initialStatus: { state: 'unavailable' },
        }),
      ),
      renderToStaticMarkup(
        createElement(VaultGate, {
          gateway: desktop,
          runtime: tauriRuntime,
          initialStatus: { state: 'locked' },
        }),
      ),
    ].join('')

    expect(html).not.toContain('style=')
    expect(html).toContain('<progress')
  })

  it('uses the loading boundary before client-side runtime detection completes', () => {
    const html = renderToStaticMarkup(
      createElement(ProductionShell, {
        gateway: gateway(browserRuntime, { state: 'unavailable' }),
        children: child('旧 App'),
      }),
    )
    expect(html).toContain('正在打开本地工作区')
    expect(html).not.toContain('旧 App')
  })

  it('keeps the empty boundary behind the browser runtime notice', () => {
    const browser = gateway(browserRuntime, { state: 'unavailable' })
    const html = renderToStaticMarkup(
      createElement(ProductionReadyShell, {
        gateway: browser,
        ready: { runtime: browserRuntime, vault: { state: 'unavailable' } },
      }),
    )
    expect(html).toContain('浏览器本地模式')
    expect(html).toContain('工作区尚未加载')
  })

  it('sanitizes raw gateway failures used by verify and lock retry flows', async () => {
    const privateDetail = '/Users/alice/private-vault.json password=never-render'
    const failing = gateway(
      tauriRuntime,
      { state: 'locked' },
      {
        verify: new Error(privateDetail),
        lock: new Error(privateDetail),
      },
    )

    const verifyError = await verifyVaultSafely(failing).catch((error: unknown) => error)
    const lockError = await lockVaultSafely(failing).catch((error: unknown) => error)

    expect(verifyError).toMatchObject({ code: 'SYSTEM_VERIFICATION_FAILED', retryable: true })
    expect(lockError).toMatchObject({ code: 'VAULT_LOCK_FAILED', retryable: true })
    expect(JSON.stringify({ verifyError, lockError })).not.toContain(privateDetail)
    const errorHtml = renderToStaticMarkup(
      createElement(ProductionErrorBoundary, {
        error: verifyError as SafeError,
        onRetry: () => undefined,
      }),
    )
    expect(errorHtml).not.toContain(privateDetail)
  })

  it('auto-locks an unlocked desktop vault after ten minutes of inactivity and resets on activity', async () => {
    vi.useFakeTimers()
    const locked: VaultStatus[] = []
    const desktop = gateway(tauriRuntime, { state: 'unlocked' })
    const controller = startVaultAutoLock(desktop, { onLocked: (status) => locked.push(status) })

    await vi.advanceTimersByTimeAsync(VAULT_AUTO_LOCK_MS - 1)
    expect(locked).toHaveLength(0)
    controller.touch()
    await vi.advanceTimersByTimeAsync(VAULT_AUTO_LOCK_MS - 1)
    expect(locked).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(locked).toEqual([{ state: 'locked' }])

    controller.dispose()
    vi.useRealTimers()
  })

  it('waits for pending project work before auto-locking', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const desktop = gateway(tauriRuntime, { state: 'unlocked' })
    desktop.lockVault = async () => {
      order.push('lock')
      return { state: 'locked' }
    }
    const controller = startVaultAutoLock(desktop, {
      timeoutMs: 1,
      beforeLock: async () => {
        order.push('flush')
      },
      onLocked: () => order.push('published'),
    })

    await vi.advanceTimersByTimeAsync(1)
    expect(order).toEqual(['flush', 'lock', 'published'])
    controller.dispose()
    vi.useRealTimers()
  })

  it('still fail-safe locks when pre-lock project flushing fails', async () => {
    vi.useFakeTimers()
    const locked: VaultStatus[] = []
    const errors: SafeError[] = []
    const desktop = gateway(tauriRuntime, { state: 'unlocked' })
    const controller = startVaultAutoLock(desktop, {
      timeoutMs: 1,
      beforeLock: async () => {
        throw new SafeError('PROJECT_WRITE_FAILED', 'write-project')
      },
      onLocked: (status) => locked.push(status),
      onError: (error) => errors.push(error),
    })

    await vi.advanceTimersByTimeAsync(1)
    expect(locked).toEqual([{ state: 'locked' }])
    expect(errors).toMatchObject([{ code: 'PROJECT_WRITE_FAILED', operation: 'write-project' }])
    controller.dispose()
    vi.useRealTimers()
  })
})
