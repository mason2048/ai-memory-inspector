import type { ContextPackage, MemoryIssue, MemoryRecord } from './types'
import { createSecureId } from './ids'
import { containsPlainSecret, redactText } from './redaction'
import { sanitizeSourceUri } from './uri'

const sensitivityRank = { public: 0, internal: 1, sensitive: 2, secret: 3 } as const

const mostSensitive = (...values: MemoryRecord['sensitivity'][]): MemoryRecord['sensitivity'] =>
  values.reduce((current, value) => sensitivityRank[value] > sensitivityRank[current] ? value : current, 'public')

export function sanitizeRecordForExport(record: MemoryRecord): MemoryRecord | null {
  if (record.sensitivity === 'secret') return null

  const title = redactText(record.title)
  const content = redactText(record.content)
  const tags = record.tags.map((tag) => redactText(tag))
  const uri = sanitizeSourceUri(record.source?.uri ?? 'unknown://source')
  const revision = redactText(record.source?.revision ?? 'unknown')
  const locator = redactText(record.source?.locator ?? '无法定位')
  const platform = redactText(record.source?.platform ?? '未知来源')
  const serializedInput = JSON.stringify(record)
  const detectedSecret = uri.sensitivity === 'secret'
    || containsPlainSecret(serializedInput)
    || [title, content, revision, locator, platform, ...tags].some((result) => result.sensitivity === 'secret')
  if (detectedSecret) return null

  const sensitivity = mostSensitive(
    record.sensitivity,
    uri.sensitivity,
    title.sensitivity,
    content.sensitivity,
    revision.sensitivity,
    locator.sensitivity,
    platform.sensitivity,
    ...tags.map((tag) => tag.sensitivity),
  )
  const sanitized: MemoryRecord = {
    ...record,
    title: title.text,
    content: content.text,
    sensitivity,
    tags: tags.map((tag) => tag.text),
    source: {
      uri: uri.text,
      revision: revision.text,
      locator: locator.text,
      platform: platform.text,
    },
  }
  return containsPlainSecret(JSON.stringify(sanitized)) ? null : sanitized
}

export function buildContextPackage(records: MemoryRecord[], issues: MemoryIssue[], createdAt = new Date().toISOString()): ContextPackage {
  const safeRecords = records.map(sanitizeRecordForExport).filter((record): record is MemoryRecord => record !== null)
  const excluded = records.length - safeRecords.length
  return {
    schemaVersion: '0.1',
    packageId: createSecureId('pkg'),
    name: 'memory-inspector-redacted-export',
    kind: 'memory',
    createdAt,
    producer: { name: 'ai-memory-inspector', version: '0.3.0' },
    items: safeRecords.map((record) => ({
      id: record.id,
      type: record.type === 'project-status' ? 'fact' : record.type === 'relationship' || record.type === 'sensitive' ? 'fact' : record.type,
      title: record.title,
      content: record.content,
      scope: record.scope,
      source: record.source,
      validity: { observedAt: record.observedAt ?? createdAt, expiresAt: record.expiresAt ?? null, confidence: record.confidence },
      sensitivity: record.sensitivity,
      tags: record.tags,
    })),
    warnings: [
      ...(excluded ? [`默认排除了 ${excluded} 条 secret 级别记录。`] : []),
      ...issues.filter((issue) => issue.detection === 'inference').map((issue) => `低置信度推断：${issue.title}`),
    ],
  }
}

export function buildMigrationMarkdown(records: MemoryRecord[], issues: MemoryIssue[]): string {
  const safe = records.map(sanitizeRecordForExport).filter((record): record is MemoryRecord => record !== null)
  const pending = issues.filter((issue) => issue.disposition === 'suggest-delete')
  return [
    '# AI 记忆迁移清单',
    '',
    '> 仅包含本次主动导入且非 secret 级别的内容。删除建议不代表厂商平台已完成删除。',
    '',
    '## 可迁移记录',
    ...safe.map((record) => `- **${record.title}**：${record.content}  \n  来源：${record.source?.uri ?? '未知'} · ${record.source?.locator ?? '无法定位'}`),
    '',
    '## 人工处理建议',
    ...(pending.length ? pending.map((issue) => `- [ ] ${issue.title}（回到对应来源人工处理）`) : ['- 暂无标记为“建议删除”的问题。']),
    '',
  ].join('\n')
}
