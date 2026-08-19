import type { ProjectState } from '../types'
import { sanitizeProjectState } from '../storage'
import type { DesktopGateway, DesktopOperation } from './contracts'
import { SafeError, toSafeError } from './safe-error'

export type NativeProjectLoadResult =
  | { status: 'empty'; project: null; revision: number }
  | { status: 'ok'; project: ProjectState; revision: number }
  | { status: 'corrupt'; project: null; revision: number }

export async function loadNativeProject(gateway: DesktopGateway): Promise<NativeProjectLoadResult> {
  const envelope = await gateway.readProject<ProjectState>()
  if (envelope.project === null) {
    return { status: 'empty', project: null, revision: envelope.revision }
  }
  const project = sanitizeProjectState(envelope.project)
  if (!project) {
    return { status: 'corrupt', project: null, revision: envelope.revision }
  }
  return { status: 'ok', project, revision: envelope.revision }
}

export class NativeProjectWriter {
  private revision: number
  private pending: Promise<void> = Promise.resolve()
  private pendingFailure: SafeError | null = null
  private closed = false
  private exclusivePending = false
  private closePromise: Promise<void> | null = null
  private lastProjectJson: string | null

  constructor(
    private readonly gateway: DesktopGateway,
    initialRevision: number,
    initialProject: ProjectState | null = null,
  ) {
    this.revision = initialRevision
    const sanitized = initialProject ? sanitizeProjectState(initialProject) : null
    this.lastProjectJson = sanitized ? JSON.stringify(sanitized) : null
  }

  get currentRevision(): number {
    return this.revision
  }

  adoptRevision(revision: number, project: ProjectState | null): void {
    if (!Number.isSafeInteger(revision) || revision < this.revision) {
      throw new SafeError('INVALID_RESPONSE', 'restore-backup')
    }
    const sanitized = project ? sanitizeProjectState(project) : null
    if (project && !sanitized) throw new SafeError('PROJECT_READ_FAILED', 'read-project')
    this.revision = revision
    this.lastProjectJson = sanitized ? JSON.stringify(sanitized) : null
  }

  save(project: ProjectState): Promise<void> {
    return this.enqueue('write-project', async () => {
      const sanitized = sanitizeProjectState(project)
      if (!sanitized) throw new SafeError('PROJECT_WRITE_FAILED', 'write-project')
      const serialized = JSON.stringify(sanitized)
      if (serialized === this.lastProjectJson) return
      const envelope = await this.gateway.writeProject(this.revision, sanitized)
      this.revision = envelope.revision
      this.lastProjectJson = serialized
    })
  }

  clear(): Promise<void> {
    return this.enqueue('clear-project', async () => {
      const envelope = await this.gateway.clearProject(this.revision)
      this.revision = envelope.revision
      this.lastProjectJson = null
    })
  }

  /**
   * Runs a native backup operation after all accepted writes, while refusing
   * any new save that could race with the snapshot or restored revision.
   */
  runExclusive<T>(
    operation: 'export-backup' | 'restore-backup',
    task: (adoptRevision: (revision: number, project: ProjectState | null) => void) => Promise<T>,
  ): Promise<T> {
    if (this.closed || this.exclusivePending) {
      return Promise.reject(toSafeError(undefined, operation))
    }
    this.exclusivePending = true
    return this.enqueue(operation, async () => {
      if (this.pendingFailure) throw this.pendingFailure
      return task((revision, project) => this.adoptRevision(revision, project))
    }).finally(() => {
      this.exclusivePending = false
    })
  }

  /** Waits until every operation already accepted by this writer has settled. */
  async flush(): Promise<void> {
    await this.pending
    if (this.pendingFailure) throw this.pendingFailure
  }

  /**
   * Refuses new writes and releases the cached serialized project after queued
   * operations settle. Vault lock flows call this before discarding a session.
   */
  close(): Promise<void> {
    if (!this.closePromise) {
      this.closed = true
      this.closePromise = this.flush().finally(() => {
        this.lastProjectJson = null
      })
    }
    return this.closePromise
  }

  private enqueue<T>(operation: DesktopOperation, task: () => Promise<T>): Promise<T> {
    if (this.closed || (this.exclusivePending && !operation.includes('backup'))) {
      return Promise.reject(toSafeError(undefined, operation))
    }
    const next = this.pending
      .then(async () => {
        const result = await task()
        this.pendingFailure = null
        return result
      })
      .catch((error: unknown) => {
        throw toSafeError(error, operation)
      })
    this.pending = next.then(
      () => undefined,
      (error: unknown) => {
        this.pendingFailure =
          error instanceof SafeError ? error : toSafeError(error, operation)
      },
    )
    return next
  }
}
