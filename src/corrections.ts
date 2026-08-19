import { parseImport } from './importer'
import { createSecureId } from './ids'
import type { MemoryRecord, MemoryRevision, Scope } from './types'

export interface CorrectionInput {
  title: string
  content: string
  scope: Scope
  reason: string
}

export interface CorrectionResult {
  record: MemoryRecord
  revision: MemoryRevision
}

const createId = () => createSecureId('revision')

export function applyCorrection(record: MemoryRecord, input: CorrectionInput, changedAt = new Date().toISOString()): CorrectionResult {
  const reason = input.reason.trim()
  if (!reason) throw new Error('请说明修正原因，以便保留可审计历史。')
  if (!input.title.trim() || !input.content.trim()) throw new Error('标题和内容不能为空。')

  const [sanitized] = parseImport(JSON.stringify({ items: [{
    ...record,
    title: input.title.trim(),
    content: input.content.trim(),
    scope: input.scope,
    sensitivity: 'public',
    tags: record.tags.filter((tag) => !['API Key', '密码', '私钥', '身份证件', '邮箱', '电话', '精确地址'].includes(tag)),
    observedAt: changedAt,
    source: {
      ...record.source,
      revision: `local-correction:${changedAt}`,
    },
  }] }), 'local-correction.json')

  const safeReason = parseImport(reason, 'correction-reason.txt')[0]?.content ?? '[修正原因已脱敏]'
  return {
    record: sanitized,
    revision: {
      id: createId(),
      recordId: record.id,
      changedAt,
      reason: safeReason,
      before: record,
      after: sanitized,
    },
  }
}

export function revisionsForRecord(revisions: MemoryRevision[], recordId: string): MemoryRevision[] {
  return revisions
    .filter((revision) => revision.recordId === recordId)
    .sort((left, right) => right.changedAt.localeCompare(left.changedAt))
}
