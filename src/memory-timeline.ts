import { redactText } from './redaction'
import { sanitizeMemoryRecordForDisplay } from './snapshot'
import type { MemoryRecord, MemoryRevision, MemorySnapshot } from './types'

export type MemoryTimelineEventKind = 'import' | 'snapshot' | 'revision'

export const SECRET_REVISION_DETAIL = '[secret 修正原因已隐藏]'

export interface MemoryTimelineEvent {
  id: string
  kind: MemoryTimelineEventKind
  at: string
  title: string
  detail: string
  before?: string
  after?: string
}

export function summarizeMemoryContent(content: string, limit = 116): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  const characters = Array.from(normalized)
  return characters.length > limit ? `${characters.slice(0, limit).join('')}…` : normalized
}

export function formatMemoryTime(value?: string | null): string {
  if (!value) return '未提供'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间无效'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function buildMemoryTimeline(
  records: MemoryRecord[],
  revisions: MemoryRevision[],
  snapshots: MemorySnapshot[],
  importedAt: string,
): MemoryTimelineEvent[] {
  const events: MemoryTimelineEvent[] = [
    {
      id: 'project-import',
      kind: 'import',
      at: importedAt,
      title: '项目导入',
      detail: `当前项目包含 ${records.length} 条规范化记忆`,
    },
    ...snapshots.map((snapshot) => ({
      id: `snapshot-${snapshot.id}`,
      kind: 'snapshot' as const,
      at: snapshot.capturedAt,
      title: redactText(snapshot.name).text || '未命名快照',
      detail: `快照保留 ${snapshot.records.length} 条记忆`,
    })),
    ...revisions.map((revision) => {
      const pairHasSecret =
        revision.before.sensitivity === 'secret' || revision.after.sensitivity === 'secret'
      const before = sanitizeMemoryRecordForDisplay(revision.before, pairHasSecret)
      const after = sanitizeMemoryRecordForDisplay(revision.after, pairHasSecret)
      return {
        id: `revision-${revision.id}`,
        kind: 'revision' as const,
        at: revision.changedAt,
        title: `修正：${after.title}`,
        detail: pairHasSecret
          ? SECRET_REVISION_DETAIL
          : redactText(revision.reason).text || '未提供修正原因',
        before: summarizeMemoryContent(before.content),
        after: summarizeMemoryContent(after.content),
      }
    }),
  ]

  return events.sort((left, right) => {
    const timeDifference = Date.parse(right.at) - Date.parse(left.at)
    return Number.isNaN(timeDifference) || timeDifference === 0
      ? left.id.localeCompare(right.id)
      : timeDifference
  })
}
