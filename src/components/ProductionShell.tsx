import {
  Children,
  Component,
  createContext,
  useContext,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createDesktopGateway } from '../desktop'
import type {
  DesktopGateway,
  DesktopRuntimeInfo,
  OperationProgress,
  VaultStatus,
} from '../desktop/contracts'
import { idleProgress, runDesktopOperation, sanitizeOperationProgress } from '../desktop/operation'
import { SafeError, toSafeError } from '../desktop/safe-error'
import { VaultGate } from './VaultGate'

export interface ProductionShellProps {
  children?: ReactNode
  gateway?: DesktopGateway
}

interface ReadyState {
  runtime: DesktopRuntimeInfo
  vault: VaultStatus
}

export const DesktopGatewayContext = createContext<DesktopGateway | null>(null)

export function useDesktopGateway(): DesktopGateway | null {
  return useContext(DesktopGatewayContext)
}

export function ProductionLoadingBoundary({ progress }: { progress: OperationProgress }) {
  const safeProgress = sanitizeOperationProgress(progress)
  return (
    <main className="production-boundary-page" aria-busy="true">
      <section className="production-boundary-card" role="status" aria-live="polite">
        <div className="production-boundary-icon" aria-hidden="true">
          ◌
        </div>
        <h1 className="production-boundary-title">正在打开本地工作区</h1>
        <p className="production-boundary-copy">
          {safeProgress.message || '正在确认本地运行环境…'}
        </p>
        <progress
          className="production-progress"
          aria-label={safeProgress.message}
          max={100}
          value={safeProgress.percent}
        >
          {safeProgress.percent}%
        </progress>
      </section>
    </main>
  )
}

export function ProductionErrorBoundary({
  error,
  onRetry,
}: {
  error: SafeError
  onRetry: () => void
}) {
  const safeError = toSafeError(error, error.operation)
  return (
    <main className="production-boundary-page">
      <section
        className="production-boundary-card"
        role="alert"
        aria-labelledby="production-error-title"
      >
        <div className="production-boundary-icon" aria-hidden="true">
          !
        </div>
        <h1 id="production-error-title" className="production-boundary-title">
          本地安全环境尚未就绪
        </h1>
        <p className="production-boundary-copy">{safeError.message}</p>
        <p className="production-boundary-copy production-boundary-fineprint">
          为保护隐私，错误页面不会显示文件路径、账户信息、凭据或记忆内容。
        </p>
        {safeError.retryable ? (
          <button type="button" className="production-retry-button" onClick={onRetry}>
            重试初始化
          </button>
        ) : null}
      </section>
    </main>
  )
}

export function ProductionEmptyBoundary() {
  return (
    <main className="production-boundary-page">
      <section className="production-boundary-card" role="status">
        <h1 className="production-boundary-title production-boundary-title-first">
          工作区尚未加载
        </h1>
        <p className="production-boundary-copy">
          生产外壳已经就绪，但还没有可显示的本地工作区内容。
        </p>
      </section>
    </main>
  )
}

class SafeRenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // Deliberately do not log the source exception: render errors can contain
    // imported content or local paths. The visible boundary is allowlisted.
  }

  render() {
    if (this.state.failed) {
      return (
        <ProductionErrorBoundary
          error={new SafeError('OPERATION_FAILED', 'initialize')}
          onRetry={() => this.setState({ failed: false })}
        />
      )
    }
    return this.props.children
  }
}

export function ProductionReadyShell({
  gateway,
  ready,
  children,
}: {
  gateway: DesktopGateway
  ready: ReadyState
  children?: ReactNode
}) {
  const content = Children.count(children) === 0 ? <ProductionEmptyBoundary /> : children
  return (
    <DesktopGatewayContext.Provider value={gateway}>
      <SafeRenderBoundary>
        <VaultGate gateway={gateway} runtime={ready.runtime} initialStatus={ready.vault}>
          {content}
        </VaultGate>
      </SafeRenderBoundary>
    </DesktopGatewayContext.Provider>
  )
}

export function ProductionShell({ children, gateway: providedGateway }: ProductionShellProps) {
  const [gateway] = useState<DesktopGateway>(() => providedGateway ?? createDesktopGateway())
  const [ready, setReady] = useState<ReadyState | null>(null)
  const [error, setError] = useState<SafeError | null>(null)
  const [progress, setProgress] = useState<OperationProgress>(() => idleProgress('initialize'))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setReady(null)
    setError(null)

    void runDesktopOperation(
      'initialize',
      async () => {
        const [runtime, vault] = await Promise.all([
          gateway.getRuntimeInfo(),
          gateway.getVaultStatus(),
        ])
        return { runtime, vault }
      },
      (next) => {
        if (active) setProgress(sanitizeOperationProgress(next))
      },
    )
      .then((next) => {
        if (active) setReady(next)
      })
      .catch((caught) => {
        if (active) setError(toSafeError(caught, 'initialize'))
      })

    return () => {
      active = false
    }
  }, [gateway, attempt])

  if (error)
    return (
      <ProductionErrorBoundary error={error} onRetry={() => setAttempt((value) => value + 1)} />
    )
  if (!ready) return <ProductionLoadingBoundary progress={progress} />
  return (
    <ProductionReadyShell gateway={gateway} ready={ready}>
      {children}
    </ProductionReadyShell>
  )
}
