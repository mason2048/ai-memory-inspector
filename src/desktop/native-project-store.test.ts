import { describe, expect, it, vi } from 'vitest'
import type { DesktopGateway, DesktopRuntimeInfo, NativeProjectEnvelope } from './contracts'
import { loadNativeProject, NativeProjectWriter } from './native-project-store'
import type { ProjectState } from '../types'

const project = (name: string): ProjectState => ({
  version: 2,
  name,
  importedAt: '2026-08-13T00:00:00.000Z',
  records: [],
  dispositions: {},
  revisions: [],
  snapshots: [],
  manualCleanupIds: [],
})

function gateway(
  read: NativeProjectEnvelope = { revision: 0, schemaVersion: 2, project: null },
): DesktopGateway & {
  writeProject: ReturnType<typeof vi.fn>
  clearProject: ReturnType<typeof vi.fn>
} {
  const runtime: DesktopRuntimeInfo = {
    kind: 'tauri',
    label: 'test',
    capabilities: {
      nativeVault: true,
      nativeFileImport: true,
      systemVerification: true,
      localOnly: true,
    },
    privacyBoundary: 'test',
  }
  let revision = read.revision
  const writeProject = vi.fn(async (_expected: number, value: unknown) => ({
    revision: ++revision,
    schemaVersion: 2,
    project: value,
  }))
  const clearProject = vi.fn(async () => ({
    revision: ++revision,
    schemaVersion: 2,
    project: null,
  }))
  return {
    kind: 'tauri',
    getRuntimeInfo: async () => runtime,
    getVaultStatus: async () => ({ state: 'unlocked' }),
    verifySystemIdentity: async () => ({ state: 'unlocked' }),
    lockVault: async () => ({ state: 'locked' }),
    readProject: async () => read,
    writeProject,
    clearProject,
    pickAndReadImport: async () => ({ cancelled: true }),
    exportBackup: async () => ({
      completed: true,
      cancelled: false,
      revision,
      schemaVersion: 2,
    }),
    restoreBackup: async () => ({
      completed: true,
      cancelled: false,
      revision: ++revision,
      schemaVersion: 2,
    }),
  }
}

describe('native encrypted project persistence', () => {
  it('rejects malformed native project shapes without partial loading', async () => {
    const native = gateway({
      revision: 3,
      schemaVersion: 2,
      project: { version: 2, records: 'not-an-array' },
    })
    await expect(loadNativeProject(native)).resolves.toEqual({
      status: 'corrupt',
      project: null,
      revision: 3,
    })
  })

  it('serializes saves and advances optimistic revisions in order', async () => {
    const native = gateway()
    const writer = new NativeProjectWriter(native, 0)
    await Promise.all([writer.save(project('first')), writer.save(project('second'))])
    expect(native.writeProject.mock.calls.map((call) => call[0])).toEqual([0, 1])
    expect(writer.currentRevision).toBe(2)
    await writer.clear()
    expect(writer.currentRevision).toBe(3)
  })

  it('skips an unchanged hydration write and sanitizes again before native persistence', async () => {
    const native = gateway({ revision: 4, schemaVersion: 2, project: project('existing') })
    const writer = new NativeProjectWriter(native, 4, project('existing'))
    await writer.save(project('existing'))
    expect(native.writeProject).not.toHaveBeenCalled()

    const unsafe: ProjectState = {
      ...project('changed'),
      records: [
        {
          id: 'unsafe',
          type: 'fact',
          title: '测试',
          content: '密码: fictitious-plain-value',
          scope: 'global',
          confidence: 0.8,
          sensitivity: 'public',
          tags: [],
        },
      ],
    }
    await writer.save(unsafe)
    expect(JSON.stringify(native.writeProject.mock.calls[0]?.[1])).not.toContain(
      'fictitious-plain-value',
    )
  })

  it('flushes accepted writes before closing and refuses writes after close', async () => {
    let releaseWrite: (() => void) | undefined
    const native = gateway()
    native.writeProject.mockImplementationOnce(
      (_expected: number, value: unknown) =>
        new Promise((resolve) => {
          releaseWrite = () => resolve({ revision: 1, schemaVersion: 2, project: value })
        }),
    )
    const writer = new NativeProjectWriter(native, 0)
    const save = writer.save(project('queued'))
    const close = writer.close()

    await expect(writer.save(project('too-late'))).rejects.toMatchObject({
      code: 'PROJECT_WRITE_FAILED',
    })
    expect(native.writeProject).toHaveBeenCalledTimes(1)
    releaseWrite?.()
    await expect(Promise.all([save, close])).resolves.toBeDefined()
    expect(writer.currentRevision).toBe(1)
  })

  it('reports a failed queued write from flush and still closes the writer', async () => {
    const native = gateway()
    native.writeProject.mockRejectedValueOnce(new Error('/private/project.json'))
    const writer = new NativeProjectWriter(native, 0)
    await expect(writer.save(project('fails'))).rejects.toMatchObject({
      code: 'PROJECT_WRITE_FAILED',
    })
    await expect(writer.close()).rejects.toMatchObject({ code: 'PROJECT_WRITE_FAILED' })
    await expect(writer.clear()).rejects.toMatchObject({ code: 'PROJECT_CLEAR_FAILED' })
    expect(native.clearProject).not.toHaveBeenCalled()
  })

  it('runs backup exclusively after queued writes and refuses racing saves', async () => {
    let releaseWrite: (() => void) | undefined
    const native = gateway()
    native.writeProject.mockImplementationOnce(
      (_expected: number, value: unknown) =>
        new Promise((resolve) => {
          releaseWrite = () => resolve({ revision: 1, schemaVersion: 2, project: value })
        }),
    )
    const writer = new NativeProjectWriter(native, 0)
    const save = writer.save(project('before-backup'))
    const order: string[] = []
    const backup = writer.runExclusive('export-backup', async () => {
      order.push('backup')
      return 'exported'
    })

    await expect(writer.save(project('racing'))).rejects.toMatchObject({
      code: 'PROJECT_WRITE_FAILED',
    })
    expect(order).toEqual([])
    releaseWrite?.()
    await expect(save).resolves.toBeUndefined()
    await expect(backup).resolves.toBe('exported')
    expect(order).toEqual(['backup'])
  })

  it('adopts a restored revision inside the exclusive transaction', async () => {
    const native = gateway()
    native.writeProject.mockImplementation(async (expected: number, value: unknown) => ({
      revision: expected + 1,
      schemaVersion: 2,
      project: value,
    }))
    const writer = new NativeProjectWriter(native, 0)
    await writer.runExclusive('restore-backup', async (adoptRevision) => {
      adoptRevision(7, project('restored'))
    })
    await writer.save(project('after-restore'))
    expect(native.writeProject).toHaveBeenCalledWith(7, project('after-restore'))
    expect(writer.currentRevision).toBe(8)
  })

  it('does not begin backup when an earlier queued write failed', async () => {
    const native = gateway()
    native.writeProject.mockRejectedValueOnce(new Error('/private/never-render'))
    const writer = new NativeProjectWriter(native, 0)
    await expect(writer.save(project('failed'))).rejects.toMatchObject({
      code: 'PROJECT_WRITE_FAILED',
    })
    const task = vi.fn(async () => 'should-not-run')
    await expect(writer.runExclusive('export-backup', task)).rejects.toMatchObject({
      code: 'PROJECT_WRITE_FAILED',
      operation: 'export-backup',
    })
    expect(task).not.toHaveBeenCalled()
  })
})
