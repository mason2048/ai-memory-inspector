import { redactText } from './redaction'
import type { MemoryRecord, MemorySnapshot, Sensitivity } from './types'

export type SnapshotMatchMethod = 'id' | 'source'

export type SnapshotField =
  | 'id'
  | 'type'
  | 'title'
  | 'content'
  | 'scope'
  | 'source.uri'
  | 'source.revision'
  | 'source.locator'
  | 'source.platform'
  | 'observedAt'
  | 'expiresAt'
  | 'confidence'
  | 'sensitivity'
  | 'tags'

export type SnapshotFieldValue = string | number | null | undefined | string[]

export interface SnapshotFieldChange {
  field: SnapshotField
  before: SnapshotFieldValue
  after: SnapshotFieldValue
}

/**
 * A deliberately small, presentation-safe description of a record. Secret-level
 * records never copy their title, content, tags, or source metadata into here.
 */
export interface SnapshotRecordSummary {
  id: string
  title: string
  preview: string
  source: string
  sensitivity: Sensitivity
}

export interface SnapshotAddedRecord {
  after: MemoryRecord
  summary: SnapshotRecordSummary
}

export interface SnapshotDeletedRecord {
  before: MemoryRecord
  summary: SnapshotRecordSummary
}

export interface SnapshotPairedRecord {
  before: MemoryRecord
  after: MemoryRecord
  beforeSummary: SnapshotRecordSummary
  afterSummary: SnapshotRecordSummary
  matchedBy: SnapshotMatchMethod
}

export interface SnapshotModifiedRecord extends SnapshotPairedRecord {
  changes: SnapshotFieldChange[]
}

export type SnapshotUnchangedRecord = SnapshotPairedRecord

export interface SnapshotDiffSummary {
  added: number
  deleted: number
  modified: number
  unchanged: number
  totalBefore: number
  totalAfter: number
}

export interface SnapshotDiff {
  added: SnapshotAddedRecord[]
  deleted: SnapshotDeletedRecord[]
  modified: SnapshotModifiedRecord[]
  unchanged: SnapshotUnchangedRecord[]
  summary: SnapshotDiffSummary
}

type RecordPair = {
  beforeIndex: number
  afterIndex: number
  matchedBy: SnapshotMatchMethod
}

const SECRET_TEXT = '[secret 级别内容已隐藏]'
const SECRET_SOURCE = '[secret 来源已隐藏]'

const fingerprint = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const safeText = (value: string): string => redactText(value).text

const safeRecordId = (record: MemoryRecord, forceSecret = false): string =>
  forceSecret || record.sensitivity === 'secret'
    ? `secret-${fingerprint(record.id)}`
    : safeText(record.id)

/**
 * Diff output is safe to render or serialize. The comparison is still performed
 * against the original values, but secret-level payloads are replaced in the
 * returned before/after records and field changes.
 */
export const sanitizeMemoryRecordForDisplay = (record: MemoryRecord, forceSecret = false): MemoryRecord => {
  const isSecret = forceSecret || record.sensitivity === 'secret'
  const source = record.source
    ? {
        uri: isSecret ? SECRET_SOURCE : safeText(record.source.uri),
        revision: isSecret ? SECRET_SOURCE : safeText(record.source.revision),
        locator: isSecret ? SECRET_SOURCE : safeText(record.source.locator),
        ...(record.source.platform === undefined
          ? {}
          : { platform: isSecret ? SECRET_SOURCE : safeText(record.source.platform) }),
      }
    : undefined

  return {
    ...record,
    id: safeRecordId(record, isSecret),
    title: isSecret ? SECRET_TEXT : safeText(record.title),
    content: isSecret ? SECRET_TEXT : safeText(record.content),
    source,
    tags: isSecret ? [SECRET_TEXT] : record.tags.map(safeText),
  }
}

const truncate = (value: string, length = 96): string => {
  const characters = Array.from(value.replace(/\s+/g, ' ').trim())
  return characters.length > length
    ? `${characters.slice(0, length).join('')}…`
    : characters.join('')
}

export function summarizeSnapshotRecord(record: MemoryRecord, forceSecret = false): SnapshotRecordSummary {
  if (forceSecret || record.sensitivity === 'secret') {
    return {
      id: safeRecordId(record, true),
      title: SECRET_TEXT,
      preview: SECRET_TEXT,
      source: SECRET_SOURCE,
      sensitivity: record.sensitivity,
    }
  }

  const safe = sanitizeMemoryRecordForDisplay(record)
  const source = safe.source
    ? [safe.source.uri, safe.source.locator].filter(Boolean).join(' · ')
    : '来源未知'
  return {
    id: safe.id,
    title: safe.title,
    preview: truncate(safe.content),
    source,
    sensitivity: safe.sensitivity,
  }
}

const fieldReaders: ReadonlyArray<{
  field: SnapshotField
  read: (record: MemoryRecord) => SnapshotFieldValue
}> = [
  { field: 'id', read: (record) => record.id },
  { field: 'type', read: (record) => record.type },
  { field: 'title', read: (record) => record.title },
  { field: 'content', read: (record) => record.content },
  { field: 'scope', read: (record) => record.scope },
  { field: 'source.uri', read: (record) => record.source?.uri },
  { field: 'source.revision', read: (record) => record.source?.revision },
  { field: 'source.locator', read: (record) => record.source?.locator },
  { field: 'source.platform', read: (record) => record.source?.platform },
  { field: 'observedAt', read: (record) => record.observedAt },
  { field: 'expiresAt', read: (record) => record.expiresAt },
  { field: 'confidence', read: (record) => record.confidence },
  { field: 'sensitivity', read: (record) => record.sensitivity },
  { field: 'tags', read: (record) => record.tags },
]

const valuesEqual = (before: SnapshotFieldValue, after: SnapshotFieldValue): boolean => {
  if (Array.isArray(before) || Array.isArray(after)) {
    return Array.isArray(before)
      && Array.isArray(after)
      && before.length === after.length
      && before.every((value, index) => value === after[index])
  }
  return Object.is(before, after)
}

export function diffSnapshotRecordFields(before: MemoryRecord, after: MemoryRecord): SnapshotFieldChange[] {
  const pairHasSecret = before.sensitivity === 'secret' || after.sensitivity === 'secret'
  const safeBefore = sanitizeMemoryRecordForDisplay(before, pairHasSecret)
  const safeAfter = sanitizeMemoryRecordForDisplay(after, pairHasSecret)
  return fieldReaders.flatMap(({ field, read }) => {
    const originalBefore = read(before)
    const originalAfter = read(after)
    if (valuesEqual(originalBefore, originalAfter)) return []
    return [{ field, before: read(safeBefore), after: read(safeAfter) }]
  })
}

const normalizedId = (record: MemoryRecord): string | undefined => {
  const id = record.id.trim()
  return id || undefined
}

const normalizedSourceKey = (record: MemoryRecord): string | undefined => {
  const uri = record.source?.uri.trim()
  const locator = record.source?.locator.trim()
  return uri && locator ? `${uri}\u0000${locator}` : undefined
}

const indexUnmatched = (
  records: MemoryRecord[],
  isMatched: boolean[],
  keyOf: (record: MemoryRecord) => string | undefined,
): Map<string, number[]> => {
  const index = new Map<string, number[]>()
  records.forEach((record, recordIndex) => {
    if (isMatched[recordIndex]) return
    const key = keyOf(record)
    if (!key) return
    const matching = index.get(key)
    if (matching) matching.push(recordIndex)
    else index.set(key, [recordIndex])
  })
  return index
}

const pairBy = (
  before: MemoryRecord[],
  after: MemoryRecord[],
  beforeMatched: boolean[],
  afterMatched: boolean[],
  keyOf: (record: MemoryRecord) => string | undefined,
  matchedBy: SnapshotMatchMethod,
): RecordPair[] => {
  const beforeIndex = indexUnmatched(before, beforeMatched, keyOf)
  const pairs: RecordPair[] = []

  after.forEach((record, afterIndex) => {
    if (afterMatched[afterIndex]) return
    const key = keyOf(record)
    if (!key) return
    const candidates = beforeIndex.get(key)
    const beforeRecordIndex = candidates?.shift()
    if (beforeRecordIndex === undefined) return
    beforeMatched[beforeRecordIndex] = true
    afterMatched[afterIndex] = true
    pairs.push({ beforeIndex: beforeRecordIndex, afterIndex, matchedBy })
  })
  return pairs
}

/**
 * Compare two complete memory snapshots. Stable IDs always get first chance to
 * match; only still-unmatched records fall back to source URI plus locator.
 */
export function compareSnapshots(before: MemorySnapshot, after: MemorySnapshot): SnapshotDiff
export function compareSnapshots(before: MemoryRecord[], after: MemoryRecord[]): SnapshotDiff
export function compareSnapshots(
  beforeInput: MemorySnapshot | MemoryRecord[],
  afterInput: MemorySnapshot | MemoryRecord[],
): SnapshotDiff {
  const before = Array.isArray(beforeInput) ? beforeInput : beforeInput.records
  const after = Array.isArray(afterInput) ? afterInput : afterInput.records
  const beforeMatched = before.map(() => false)
  const afterMatched = after.map(() => false)
  const pairs = [
    ...pairBy(before, after, beforeMatched, afterMatched, normalizedId, 'id'),
    ...pairBy(before, after, beforeMatched, afterMatched, normalizedSourceKey, 'source'),
  ].sort((left, right) => left.afterIndex - right.afterIndex)

  const modified: SnapshotModifiedRecord[] = []
  const unchanged: SnapshotUnchangedRecord[] = []

  pairs.forEach(({ beforeIndex, afterIndex, matchedBy }) => {
    const originalBefore = before[beforeIndex]
    const originalAfter = after[afterIndex]
    const pairHasSecret = originalBefore.sensitivity === 'secret' || originalAfter.sensitivity === 'secret'
    const changes = diffSnapshotRecordFields(originalBefore, originalAfter)
    const paired: SnapshotPairedRecord = {
      before: sanitizeMemoryRecordForDisplay(originalBefore, pairHasSecret),
      after: sanitizeMemoryRecordForDisplay(originalAfter, pairHasSecret),
      beforeSummary: summarizeSnapshotRecord(originalBefore, pairHasSecret),
      afterSummary: summarizeSnapshotRecord(originalAfter, pairHasSecret),
      matchedBy,
    }
    if (changes.length > 0) modified.push({ ...paired, changes })
    else unchanged.push(paired)
  })

  const added = after.flatMap((record, index): SnapshotAddedRecord[] =>
    afterMatched[index]
      ? []
      : [{ after: sanitizeMemoryRecordForDisplay(record), summary: summarizeSnapshotRecord(record) }])
  const deleted = before.flatMap((record, index): SnapshotDeletedRecord[] =>
    beforeMatched[index]
      ? []
      : [{ before: sanitizeMemoryRecordForDisplay(record), summary: summarizeSnapshotRecord(record) }])

  return {
    added,
    deleted,
    modified,
    unchanged,
    summary: {
      added: added.length,
      deleted: deleted.length,
      modified: modified.length,
      unchanged: unchanged.length,
      totalBefore: before.length,
      totalAfter: after.length,
    },
  }
}

export const diffSnapshots = compareSnapshots
