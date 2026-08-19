export type MemoryType =
  'fact' | 'preference' | 'project-status' | 'instruction' | 'relationship' | 'sensitive'
export type Scope = 'global' | 'project' | 'task'
export type Sensitivity = 'public' | 'internal' | 'sensitive' | 'secret'
export type Severity = 'blocker' | 'high' | 'medium' | 'low'
export type IssueKind = 'sensitive' | 'conflict' | 'stale' | 'duplicate' | 'unsourced'
export type Disposition = 'unreviewed' | 'keep' | 'ignore' | 'suggest-delete' | 'corrected'

export interface MemorySource {
  uri: string
  revision: string
  locator: string
  platform?: string
}

export interface MemoryRecord {
  id: string
  type: MemoryType
  title: string
  content: string
  scope: Scope
  source?: MemorySource
  observedAt?: string
  expiresAt?: string | null
  confidence: number
  sensitivity: Sensitivity
  tags: string[]
}

export interface MemoryRevision {
  id: string
  recordId: string
  changedAt: string
  reason: string
  before: MemoryRecord
  after: MemoryRecord
}

export interface MemorySnapshot {
  id: string
  name: string
  capturedAt: string
  records: MemoryRecord[]
}

export interface SearchIndexEntry {
  recordId: string
  terms: string
  sourceKey: string
}

export interface MemoryIssue {
  id: string
  kind: IssueKind
  severity: Severity
  title: string
  explanation: string
  sourceIds: string[]
  detection: 'rule' | 'inference'
  disposition: Disposition
}

export interface ProjectState {
  version: 2
  name: string
  importedAt: string
  records: MemoryRecord[]
  dispositions: Record<string, Disposition>
  revisions: MemoryRevision[]
  snapshots: MemorySnapshot[]
  manualCleanupIds: string[]
  customRuleSet?: unknown
  searchIndex?: SearchIndexEntry[]
}

export interface ContextPackage {
  schemaVersion: '0.1'
  packageId: string
  name: string
  kind: 'memory'
  createdAt: string
  producer: { name: string; version: string }
  items: Array<Record<string, unknown>>
  warnings: string[]
}
