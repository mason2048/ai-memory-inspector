import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  DesktopGateway,
  DesktopRuntimeInfo,
  OperationProgress,
  VaultStatus,
} from '../desktop/contracts'
import { loadNativeProject, NativeProjectWriter } from '../desktop/native-project-store'
import { idleProgress, sanitizeOperationProgress } from '../desktop/operation'
import { SafeError, toSafeError } from '../desktop/safe-error'
import type { ProjectState } from '../types'

export interface VaultGateProps {
  gateway: DesktopGateway
  runtime: DesktopRuntimeInfo
  initialStatus: VaultStatus
  children?: ReactNode
  onStatusChange?: (status: VaultStatus) => void
}

export interface NativeProjectSession {
  project: ProjectState | null
  writer: NativeProjectWriter
}

const NativeProjectContext = createContext<NativeProjectSession | null>(null)

export function useNativeProjectSession(): NativeProjectSession | null {
  return useContext(NativeProjectContext)
}

export const VAULT_AUTO_LOCK_MS = 10 * 60 * 1000

interface AutoLockControllerOptions {
  timeoutMs?: number
  beforeLock?: () => Promise<void>
  onLocked: (status: VaultStatus) => void
  onProgress?: (progress: OperationProgress) => void
  onError?: (error: SafeError) => void
}

export function startVaultAutoLock(
  gateway: DesktopGateway,
  {
    timeoutMs = VAULT_AUTO_LOCK_MS,
    beforeLock,
    onLocked,
    onProgress,
    onError,
  }: AutoLockControllerOptions,
) {
  let disposed = false
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined

  const clear = () => {
    if (timer !== undefined) globalThis.clearTimeout(timer)
    timer = undefined
  }

  const lock = async () => {
    clear()
    let preparationError: SafeError | null = null
    try {
      await beforeLock?.()
    } catch (caught) {
      preparationError = toSafeError(caught, 'write-project')
    }
    try {
      const next = await lockVaultSafely(gateway, onProgress)
      if (!disposed) {
        onLocked(next)
        if (preparationError) onError?.(preparationError)
      }
    } catch (caught) {
      if (!disposed) onError?.(toSafeError(caught, 'lock-vault'))
    }
  }

  const touch = () => {
    if (disposed) return
    clear()
    timer = globalThis.setTimeout(
      () => {
        void lock()
      },
      Math.max(0, timeoutMs),
    )
  }

  touch()
  return {
    touch,
    dispose: () => {
      disposed = true
      clear()
    },
  }
}

export async function verifyVaultSafely(
  gateway: DesktopGateway,
  onProgress?: (progress: OperationProgress) => void,
): Promise<VaultStatus> {
  try {
    return await gateway.verifySystemIdentity((progress) =>
      onProgress?.(sanitizeOperationProgress(progress)),
    )
  } catch (error) {
    throw toSafeError(error, 'system-verification')
  }
}

export async function lockVaultSafely(
  gateway: DesktopGateway,
  onProgress?: (progress: OperationProgress) => void,
): Promise<VaultStatus> {
  try {
    return await gateway.lockVault((progress) => onProgress?.(sanitizeOperationProgress(progress)))
  } catch (error) {
    throw toSafeError(error, 'lock-vault')
  }
}

function ProgressLine({ progress }: { progress: OperationProgress }) {
  const safeProgress = sanitizeOperationProgress(progress)
  if (safeProgress.phase !== 'running') return null
  return (
    <div className="production-progress-block">
      <progress
        className="production-progress"
        aria-label={safeProgress.message}
        max={100}
        value={safeProgress.percent}
      >
        {safeProgress.percent}%
      </progress>
      <p className="production-copy production-progress-copy" aria-live="polite">
        {safeProgress.message}
      </p>
    </div>
  )
}

export function VaultGate({
  gateway,
  runtime,
  initialStatus,
  children,
  onStatusChange,
}: VaultGateProps) {
  const [status, setStatus] = useState(initialStatus)
  const [progress, setProgress] = useState<OperationProgress>(() =>
    idleProgress('system-verification'),
  )
  const [error, setError] = useState<SafeError | null>(null)
  const [privacyShielded, setPrivacyShielded] = useState(false)
  const [nativeProjectSession, setNativeProjectSession] = useState<NativeProjectSession | null>(
    null,
  )
  const initialProjectLoad = useRef<ReturnType<typeof loadNativeProject> | null>(null)
  const busy = progress.phase === 'running'

  const publishStatus = useCallback(
    (next: VaultStatus) => {
      if (next.state !== 'unlocked') setNativeProjectSession(null)
      setStatus(next)
      onStatusChange?.(next)
    },
    [onStatusChange],
  )

  const closeNativeSession = useCallback(async () => {
    await nativeProjectSession?.writer.close()
  }, [nativeProjectSession])

  const prepareForLock = useCallback(async () => {
    document.documentElement.classList.add('vault-privacy-active')
    setPrivacyShielded(true)
    await closeNativeSession()
  }, [closeNativeSession])

  const failClosedAfterProjectRead = useCallback(
    async (caught: unknown, isActive: () => boolean = () => true) => {
      try {
        await lockVaultSafely(gateway, setProgress)
      } catch {
        // Even if native lock confirmation fails, the renderer must stop
        // exposing project data and require a fresh application start.
      }
      if (!isActive()) return
      setNativeProjectSession(null)
      publishStatus({ state: 'locked' })
      setError(toSafeError(caught, 'read-project'))
    },
    [gateway, publishStatus],
  )

  const verify = async () => {
    if (busy) return
    setError(null)
    let nativeUnlocked = false
    try {
      const next = await verifyVaultSafely(gateway, setProgress)
      nativeUnlocked = next.state === 'unlocked'
      const loaded = await loadNativeProject(gateway)
      if (loaded.status === 'corrupt') {
        throw new SafeError('PROJECT_READ_FAILED', 'read-project')
      }
      setNativeProjectSession({
        project: loaded.project,
        writer: new NativeProjectWriter(gateway, loaded.revision, loaded.project),
      })
      publishStatus(next)
    } catch (caught) {
      if (nativeUnlocked) {
        await failClosedAfterProjectRead(caught)
      } else {
        setError(toSafeError(caught, 'system-verification'))
      }
    }
  }

  const lock = async () => {
    if (busy) return
    setError(null)
    let writeError: SafeError | null = null
    try {
      await prepareForLock()
    } catch (caught) {
      writeError = toSafeError(caught, 'write-project')
    }
    try {
      publishStatus(await lockVaultSafely(gateway, setProgress))
      if (writeError) setError(writeError)
    } catch (caught) {
      publishStatus({ state: 'locked' })
      setError(toSafeError(caught, 'lock-vault'))
    }
  }

  useEffect(() => {
    if (
      !runtime.capabilities.nativeVault ||
      status.state !== 'unlocked' ||
      nativeProjectSession
    )
      return undefined

    let active = true
    setError(null)
    initialProjectLoad.current ??= loadNativeProject(gateway)
    const load = initialProjectLoad.current
    void load
      .then((loaded) => {
        if (!active) return
        if (loaded.status === 'corrupt') {
          throw new SafeError('PROJECT_READ_FAILED', 'read-project')
        }
        setNativeProjectSession({
          project: loaded.project,
          writer: new NativeProjectWriter(gateway, loaded.revision, loaded.project),
        })
      })
      .catch((caught) => failClosedAfterProjectRead(caught, () => active))
      .finally(() => {
        if (initialProjectLoad.current === load) initialProjectLoad.current = null
      })
    return () => {
      active = false
    }
  }, [
    failClosedAfterProjectRead,
    gateway,
    nativeProjectSession,
    runtime.capabilities.nativeVault,
    status.state,
  ])

  useEffect(() => {
    if (!runtime.capabilities.nativeVault || status.state !== 'unlocked') return undefined

    const controller = startVaultAutoLock(gateway, {
      beforeLock: prepareForLock,
      onLocked: publishStatus,
      onProgress: setProgress,
      onError: (safeError) => {
        publishStatus({ state: 'locked' })
        setError(safeError)
      },
    })
    const activity = () => controller.touch()
    document.addEventListener('pointerdown', activity, { passive: true })
    document.addEventListener('keydown', activity)
    window.addEventListener('focus', activity)
    return () => {
      controller.dispose()
      document.removeEventListener('pointerdown', activity)
      document.removeEventListener('keydown', activity)
      window.removeEventListener('focus', activity)
    }
  }, [
    gateway,
    prepareForLock,
    publishStatus,
    runtime.capabilities.nativeVault,
    status.state,
  ])

  useEffect(() => {
    if (!runtime.capabilities.nativeVault || status.state !== 'unlocked') {
      document.documentElement.classList.remove('vault-privacy-active')
      setPrivacyShielded(false)
      return undefined
    }
    const shield = () => {
      document.documentElement.classList.add('vault-privacy-active')
      setPrivacyShielded(true)
    }
    const shieldWhenHidden = () => {
      if (document.visibilityState === 'hidden') shield()
    }
    window.addEventListener('blur', shield)
    document.addEventListener('visibilitychange', shieldWhenHidden)
    return () => {
      document.documentElement.classList.remove('vault-privacy-active')
      window.removeEventListener('blur', shield)
      document.removeEventListener('visibilitychange', shieldWhenHidden)
    }
  }, [runtime.capabilities.nativeVault, status.state])

  if (!runtime.capabilities.nativeVault || status.state === 'unavailable') {
    return (
      <>
        <section className="vault-browser-boundary" aria-label="浏览器模式隐私边界">
          <span>
            <strong>浏览器本地模式：</strong>
            没有系统保险库或系统身份验证。请仅导入你有权处理的副本，并使用设备本身的登录与磁盘保护。
          </span>
          <span className="vault-runtime-label">{runtime.label}</span>
        </section>
        <div className="production-legacy-content">{children}</div>
      </>
    )
  }

  if (status.state !== 'unlocked') {
    const verificationAvailable = runtime.capabilities.systemVerification
    return (
      <main className="production-boundary-page">
        <section className="vault-gate-card" aria-labelledby="vault-gate-title">
          <div className="vault-gate-icon" aria-hidden="true">
            ⌾
          </div>
          <span className="vault-gate-runtime">{runtime.label}</span>
          <h1 id="vault-gate-title" className="vault-gate-title">
            本地保险库已锁定
          </h1>
          <p className="production-copy">
            {verificationAvailable
              ? '通过操作系统确认当前设备用户后，才能查看已导入的本地记忆副本。'
              : '桌面保险库保持锁定。系统解锁尚未实现，当前版本不会收集口令或绕过此生产阻断。'}
          </p>
          <div className="vault-privacy-boundary">
            <strong>隐私边界</strong>
            <br />
            {runtime.privacyBoundary} 本应用不会接收系统密码，也不会把记忆内容发送给验证接口。
          </div>
          <ProgressLine progress={progress} />
          {error ? (
            <p className="production-inline-error" role="alert">
              {error.message}
            </p>
          ) : null}
          <button
            type="button"
            className="production-primary-button"
            disabled={busy || !verificationAvailable}
            onClick={() => void verify()}
          >
            {!verificationAvailable
              ? '系统解锁尚未实现 · 生产阻断'
              : busy
                ? '等待系统验证…'
                : error?.retryable
                  ? '重试系统验证'
                  : '使用系统验证解锁'}
          </button>
          <p className="production-copy vault-gate-footnote">
            取消或失败不会解锁，也不会清除或修改任何平台数据。
          </p>
        </section>
      </main>
    )
  }

  if (runtime.capabilities.nativeVault && !nativeProjectSession) {
    return (
      <main className="production-boundary-page" aria-busy="true">
        <section className="production-boundary-card" role="status" aria-live="polite">
          <div className="production-boundary-icon" aria-hidden="true">
            ◌
          </div>
          <h1 className="production-boundary-title">正在读取加密项目</h1>
          <p className="production-boundary-copy">系统验证已完成，正在打开本机加密资料库…</p>
          <progress
            className="production-progress"
            aria-label="正在读取加密项目"
            max={100}
            value={35}
          >
            35%
          </progress>
        </section>
      </main>
    )
  }

  return (
    <>
      <aside className="vault-unlocked-boundary" role="status" aria-label="保险库状态">
        <span>本地保险库已解锁 · {runtime.privacyBoundary}</span>
        <button
          type="button"
          className="production-secondary-button"
          disabled={busy}
          onClick={() => void lock()}
        >
          {busy ? '正在锁定…' : '锁定保险库'}
        </button>
      </aside>
      {error ? (
        <p className="production-inline-error production-inline-error-flush" role="alert">
          {error.message}
        </p>
      ) : null}
      <NativeProjectContext.Provider value={nativeProjectSession}>
        <div
          className="production-legacy-content"
          aria-hidden={privacyShielded || undefined}
          inert={privacyShielded || undefined}
        >
          {children}
        </div>
      </NativeProjectContext.Provider>
      {privacyShielded ? (
        <main className="production-boundary-page vault-privacy-shield">
          <section
            className="production-boundary-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vault-privacy-shield-title"
          >
            <div className="production-boundary-icon" aria-hidden="true">
              ◉
            </div>
            <h1 id="vault-privacy-shield-title" className="production-boundary-title">
              内容已遮罩
            </h1>
            <p className="production-boundary-copy">
              窗口刚刚失去焦点或应用进入后台。保险库仍保持解锁，但记忆内容不会显示。
            </p>
            <button
              type="button"
              className="production-retry-button"
              onClick={() => {
                document.documentElement.classList.remove('vault-privacy-active')
                setPrivacyShielded(false)
              }}
            >
              继续查看
            </button>
          </section>
        </main>
      ) : null}
    </>
  )
}
