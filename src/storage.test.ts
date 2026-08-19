import { describe, expect, it } from 'vitest'
import { buildSearchIndex, clearAllLocalData, INDEX_STORAGE_KEY, loadProject, loadProjectWithStatus, loadSearchIndex, resolveBrowserStorage, saveProject, saveSearchIndex, STORAGE_KEY, wasProjectCleared } from './storage'
import type { ProjectState } from './types'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('local project lifecycle', () => {
  it('saves, reloads, and completely clears the application data key', () => {
    const storage = new MemoryStorage()
    const project: ProjectState = { version: 2, name: 'demo', importedAt: '2026-08-12', records: [], dispositions: {}, revisions: [], snapshots: [], manualCleanupIds: [] }
    saveProject(storage, project)
    expect(loadProject(storage)?.name).toBe('demo')
    saveSearchIndex(storage, [{ recordId: 'a', terms: 'test', sourceKey: 'source' }])
    clearAllLocalData(storage)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    expect(storage.getItem(INDEX_STORAGE_KEY)).toBeNull()
    expect(loadProject(storage)).toBeNull()
  })

  it('sanitizes legacy local data again while loading', () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, name: 'legacy', importedAt: '2026-08-12', dispositions: {}, records: [{ id: 'x', content: '密码: old-secret-value', title: '旧记录', scope: 'global', confidence: 0.8, sensitivity: 'public', tags: [] }] }))
    const loaded = loadProject(storage)
    expect(JSON.stringify(loaded)).not.toContain('old-secret-value')
    expect(loaded?.records[0].sensitivity).toBe('secret')
  })

  it('keeps the search index separate and excludes declared secret records', () => {
    const entries = buildSearchIndex([
      { id: 'safe', type: 'fact', title: '安全', content: '普通内容', scope: 'global', confidence: 0.8, sensitivity: 'public', tags: [] },
      { id: 'secret', type: 'fact', title: '隐私', content: 'NON-PATTERN-CLASSIFIED-DATA', scope: 'global', confidence: 0.8, sensitivity: 'secret', tags: [] },
    ])
    expect(entries.map((entry) => entry.recordId)).toEqual(['safe'])
    expect(JSON.stringify(entries)).not.toContain('NON-PATTERN-CLASSIFIED-DATA')
  })

  it('sanitizes nested revisions and snapshots before writing', () => {
    const storage = new MemoryStorage()
    const unsafe = { id: 'x', type: 'fact' as const, title: '记录', content: '密码: plain-password', scope: 'global' as const, confidence: 0.8, sensitivity: 'public' as const, tags: [] }
    saveProject(storage, { version: 2, name: 'safe-write', importedAt: '2026-08-12', records: [unsafe], dispositions: {}, revisions: [{ id: 'r', recordId: 'x', changedAt: '2026-08-12', reason: '原因', before: unsafe, after: unsafe }], snapshots: [{ id: 's', name: '快照', capturedAt: '2026-08-12', records: [unsafe] }], manualCleanupIds: [] })
    expect(storage.getItem(STORAGE_KEY)).not.toContain('plain-password')
  })

  it('reports corrupted project data instead of silently replacing it with demo data', () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, '{broken-json')
    expect(loadProjectWithStatus(storage)).toMatchObject({ status: 'corrupt', project: null })
    expect(loadProject(storage)).toBeNull()
    expect(storage.getItem(STORAGE_KEY)).toBe('{broken-json')
  })

  it('recognizes invalid shapes and corrupted search indexes without throwing', () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, records: 'not-an-array' }))
    expect(loadProjectWithStatus(storage)).toMatchObject({ status: 'corrupt', project: null })
    storage.setItem(INDEX_STORAGE_KEY, '{broken')
    expect(loadSearchIndex(storage)).toEqual([])
    storage.setItem(INDEX_STORAGE_KEY, JSON.stringify([{ recordId: 'ok', terms: 'term' }, { recordId: 3, terms: false }]))
    expect(loadSearchIndex(storage)).toEqual([{ recordId: 'ok', terms: 'term' }])
  })

  it('drops malformed nested history, dispositions, and rule payloads without throwing', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        name: 'nested validation',
        importedAt: '2026-08-13T00:00:00.000Z',
        records: [],
        revisions: [{ id: 'broken', before: null, after: 'invalid' }],
        snapshots: [{ id: 'broken', records: 'invalid' }],
        manualCleanupIds: [],
        dispositions: { safe: 'keep', unsafe: 'execute-code' },
        customRuleSet: { schemaVersion: '1', rules: 'invalid' },
      }),
    )
    const loaded = loadProjectWithStatus(storage)
    expect(loaded).toMatchObject({
      status: 'ok',
      project: {
        revisions: [],
        snapshots: [],
        dispositions: { safe: 'keep' },
      },
    })
    if (loaded.status === 'ok') expect(loaded.project.customRuleSet).toBeUndefined()
  })

  it('rejects missing and future project schemas instead of silently downgrading them', () => {
    const storage = new MemoryStorage()
    for (const candidate of [
      { records: [] },
      { version: 3, records: [] },
      {
        version: 2,
        name: 'incomplete',
        importedAt: '2026-08-13T00:00:00.000Z',
        records: [],
      },
    ]) {
      storage.setItem(STORAGE_KEY, JSON.stringify(candidate))
      expect(loadProjectWithStatus(storage)).toMatchObject({ status: 'corrupt', project: null })
    }
  })

  it('marks a cleared project and supports the browser storage capability probe', () => {
    const storage = new MemoryStorage()
    clearAllLocalData(storage)
    expect(wasProjectCleared(storage)).toBe(true)

    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    try {
      expect(resolveBrowserStorage()).toEqual({ storage, persistent: true })
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('falls back to volatile storage when persistent storage is blocked', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('blocked', 'SecurityError') },
    })
    try {
      const fallback = resolveBrowserStorage()
      expect(fallback.persistent).toBe(false)
      fallback.storage.setItem('session', 'safe')
      expect(fallback.storage.getItem('session')).toBe('safe')
      expect(fallback.storage.key(0)).toBe('session')
      fallback.storage.clear()
      expect(fallback.storage.length).toBe(0)
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
})
