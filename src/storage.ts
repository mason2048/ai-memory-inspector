import type {
  MemoryRecord,
  MemoryRevision,
  MemorySnapshot,
  ProjectState,
  SearchIndexEntry,
} from './types'
import { parseImport } from './importer'
import { redactText } from './redaction'
import { validateCustomRuleSet } from './custom-rules'

export const STORAGE_KEY = 'ai-memory-inspector.records.v2'
export const LEGACY_STORAGE_KEY = 'ai-memory-inspector.project.v1'
export const INDEX_STORAGE_KEY = 'ai-memory-inspector.search-index.v1'
export const EMPTY_STATE_KEY = 'ai-memory-inspector.cleared.v1'

class VolatileStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const volatileStorage = new VolatileStorage()

export function createVolatileStorage(): { storage: Storage; persistent: false } {
  return { storage: new VolatileStorage(), persistent: false }
}

export function resolveBrowserStorage(): { storage: Storage; persistent: boolean } {
  try {
    const storage = globalThis.localStorage
    const probe = 'ai-memory-inspector.storage-probe'
    storage.setItem(probe, probe)
    storage.removeItem(probe)
    return { storage, persistent: true }
  } catch {
    return { storage: volatileStorage, persistent: false }
  }
}

const sanitizeRecords = (records: unknown[], fileName: string) =>
  parseImport(JSON.stringify({ items: records }), fileName)

const sanitizeRevisions = (revisions: unknown[]): MemoryRevision[] =>
  revisions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const revision = candidate as Partial<MemoryRevision>
    if (!revision.before || typeof revision.before !== 'object') return []
    if (!revision.after || typeof revision.after !== 'object') return []
    const before = sanitizeRecords([revision.before], 'revision-before.json')[0]
    const after = sanitizeRecords([revision.after], 'revision-after.json')[0]
    if (!before || !after) return []
    return [{
      id: redactText(String(revision.id ?? '')).text,
      recordId: after.id || before.id || redactText(String(revision.recordId ?? '')).text,
      changedAt: redactText(String(revision.changedAt ?? '')).text,
      reason: redactText(String(revision.reason ?? '')).text,
      before,
      after,
    }]
  })

const sanitizeSnapshots = (snapshots: unknown[]): MemorySnapshot[] =>
  snapshots.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const snapshot = candidate as Partial<MemorySnapshot>
    if (!Array.isArray(snapshot.records)) return []
    const id = redactText(String(snapshot.id ?? '')).text
    return [{
      id,
      name: redactText(String(snapshot.name ?? '')).text,
      capturedAt: redactText(String(snapshot.capturedAt ?? '')).text,
      records: sanitizeRecords(snapshot.records, `snapshot-${id}.json`),
    }]
  })

export function buildSearchIndex(records: MemoryRecord[]): SearchIndexEntry[] {
  return records
    .filter((record) => record.sensitivity !== 'secret')
    .map((record) => ({
      recordId: record.id,
      terms: [
        record.title,
        record.content,
        record.type,
        record.scope,
        record.sensitivity,
        ...record.tags,
      ]
        .join(' ')
        .toLocaleLowerCase('zh-CN'),
      sourceKey: [record.source?.platform, record.source?.uri, record.source?.locator]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('zh-CN'),
    }))
}

export function saveProject(storage: Storage, project: ProjectState): void {
  const sanitized = sanitizeProjectState(project)
  if (!sanitized) throw new Error('project cannot be safely persisted')
  storage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
  storage.removeItem(EMPTY_STATE_KEY)
}

export function saveSearchIndex(storage: Storage, entries: SearchIndexEntry[]): void {
  storage.setItem(
    INDEX_STORAGE_KEY,
    JSON.stringify(
      entries.map((entry) => ({
        recordId: redactText(entry.recordId).text,
        terms: redactText(entry.terms).text,
        sourceKey: redactText(entry.sourceKey).text,
      })),
    ),
  )
}

export type ProjectLoadResult =
  | { status: 'empty'; project: null }
  | { status: 'ok'; project: ProjectState }
  | { status: 'corrupt'; project: null; message: string }

export function sanitizeProjectState(input: unknown): ProjectState | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  if (raw.version !== 1 && raw.version !== 2) return null
  const parsed = input as Partial<ProjectState>
  if (!Array.isArray(parsed.records)) return null
  if (
    parsed.version === 2 &&
    (typeof parsed.name !== 'string' ||
      typeof parsed.importedAt !== 'string' ||
      !parsed.dispositions ||
      typeof parsed.dispositions !== 'object' ||
      Array.isArray(parsed.dispositions) ||
      !Array.isArray(parsed.revisions) ||
      !Array.isArray(parsed.snapshots) ||
      !Array.isArray(parsed.manualCleanupIds) ||
      (parsed.searchIndex !== undefined && !Array.isArray(parsed.searchIndex)))
  )
    return null
  try {
    const records = sanitizeRecords(parsed.records, 'local-project.json')
    const safeRecordIds = new Set(
      records.filter((record) => record.sensitivity !== 'secret').map((record) => record.id),
    )
    const dispositions: Record<string, ProjectState['dispositions'][string]> = {}
    if (parsed.dispositions && typeof parsed.dispositions === 'object') {
      for (const [rawId, value] of Object.entries(parsed.dispositions)) {
        if (
          value === 'unreviewed' ||
          value === 'keep' ||
          value === 'ignore' ||
          value === 'suggest-delete' ||
          value === 'corrected'
        ) {
          dispositions[redactText(rawId).text] = value
        }
      }
    }
    const validatedRules = validateCustomRuleSet(parsed.customRuleSet)
    return {
      version: 2,
      name: redactText(
        typeof parsed.name === 'string' ? parsed.name : '本地记忆检查',
      ).text,
      importedAt: redactText(
        typeof parsed.importedAt === 'string' ? parsed.importedAt : new Date().toISOString(),
      ).text,
      records,
      dispositions,
      revisions: Array.isArray(parsed.revisions) ? sanitizeRevisions(parsed.revisions) : [],
      snapshots: Array.isArray(parsed.snapshots) ? sanitizeSnapshots(parsed.snapshots) : [],
      manualCleanupIds: Array.isArray(parsed.manualCleanupIds)
        ? [
            ...new Set(
              parsed.manualCleanupIds
                .slice(0, 5_000)
                .map((id) => redactText(String(id)).text),
            ),
          ]
        : [],
      ...(validatedRules.ok ? { customRuleSet: validatedRules.value } : {}),
      searchIndex: Array.isArray(parsed.searchIndex)
        ? parsed.searchIndex
            .slice(0, 5_000)
            .filter(
              (entry) =>
                typeof entry.recordId === 'string' &&
                safeRecordIds.has(entry.recordId) &&
                typeof entry.terms === 'string' &&
                typeof entry.sourceKey === 'string',
            )
            .map((entry) => ({
              recordId: redactText(entry.recordId).text,
              terms: redactText(entry.terms).text,
              sourceKey: redactText(entry.sourceKey).text,
            }))
        : undefined,
    }
  } catch {
    return null
  }
}

export function loadProjectWithStatus(storage: Storage): ProjectLoadResult {
  const raw = storage.getItem(STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) return { status: 'empty', project: null }
  try {
    const project = sanitizeProjectState(JSON.parse(raw))
    if (!project)
      return {
        status: 'corrupt',
        project: null,
        message: '本地项目结构无效，已停止自动载入。',
      }
    return { status: 'ok', project }
  } catch {
    return {
      status: 'corrupt',
      project: null,
      message: '本地项目无法解析，已停止自动载入；请先保留原数据并使用恢复工具。',
    }
  }
}

export function loadProject(storage: Storage): ProjectState | null {
  return loadProjectWithStatus(storage).project
}

export function loadSearchIndex(storage: Storage): SearchIndexEntry[] {
  const raw = storage.getItem(INDEX_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as SearchIndexEntry[]
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry) => typeof entry.recordId === 'string' && typeof entry.terms === 'string',
        )
      : []
  } catch {
    return []
  }
}

export function clearProject(storage: Storage): void {
  storage.removeItem(STORAGE_KEY)
  storage.removeItem(LEGACY_STORAGE_KEY)
}

export function clearSearchIndex(storage: Storage): void {
  storage.removeItem(INDEX_STORAGE_KEY)
}

export function clearAllLocalData(storage: Storage): void {
  clearProject(storage)
  clearSearchIndex(storage)
  storage.setItem(EMPTY_STATE_KEY, 'true')
}

export function wasProjectCleared(storage: Storage): boolean {
  return storage.getItem(EMPTY_STATE_KEY) === 'true'
}
