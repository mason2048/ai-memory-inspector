import { redactText } from './redaction'
import type { MemoryIssue, MemoryRecord } from './types'

export type CleanupAction = 'delete' | 'correct' | 'review'
export type CleanupPlatform = 'chatgpt' | 'claude' | 'codex' | 'local' | 'other'

export interface CleanupSourceReference {
  recordId: string
  platform: string
  uri: string
  locator: string
  revision: string
}

export interface CleanupStep {
  id: string
  issueId: string
  issueTitle: string
  action: CleanupAction
  manual: true
  status: 'pending-manual'
  localState: 'unchanged' | 'corrected'
  instruction: string
  source: CleanupSourceReference
  relatedSourceIds: string[]
}

export interface CleanupPlatformGroup {
  platform: CleanupPlatform
  label: string
  steps: CleanupStep[]
}

export interface CleanupChecklist {
  title: string
  generatedAt: string
  execution: 'manual-only'
  boundary: string
  totalSteps: number
  groups: CleanupPlatformGroup[]
}

const platformOrder: CleanupPlatform[] = ['chatgpt', 'claude', 'codex', 'local', 'other']

const platformLabels: Record<CleanupPlatform, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  codex: 'Codex',
  local: '本地文件',
  other: '未知/其他',
}

const inline = (value: unknown, fallback: string) => {
  const text = redactText(String(value ?? '')).text.replace(/\s+/g, ' ').trim()
  return text || fallback
}

/**
 * Classifies an imported source without assuming that a file:// export belongs
 * to the local-file group when its platform explicitly names an AI product.
 */
export function classifyCleanupPlatform(record?: MemoryRecord): CleanupPlatform {
  const platform = record?.source?.platform?.trim() ?? ''
  const uri = record?.source?.uri?.trim() ?? ''
  const candidate = `${platform} ${uri}`.toLowerCase()

  if (/\bchatgpt\b|\bopenai\b/.test(candidate)) return 'chatgpt'
  if (/\bclaude\b|\banthropic\b/.test(candidate)) return 'claude'
  if (/\bcodex\b/.test(candidate)) return 'codex'
  if (/本地|local|markdown|(?:^|\W)(?:md|txt)(?:\W|$)|文件/i.test(platform) || /^file:\/\//i.test(uri)) return 'local'
  return 'other'
}

const actionFor = (issue: MemoryIssue): CleanupAction | null => {
  // String comparison keeps this module compatible while older saved projects
  // are migrated to the P1 `corrected` disposition.
  const disposition = issue.disposition as string
  if (disposition === 'keep' || disposition === 'ignore') return null
  if (disposition === 'suggest-delete') return 'delete'
  if (disposition === 'corrected') return 'correct'
  if (issue.kind === 'conflict' || issue.kind === 'stale' || issue.kind === 'unsourced') return 'correct'
  return 'review'
}

const instructionFor = (
  action: CleanupAction,
  platform: CleanupPlatform,
  locallyCorrected: boolean,
) => {
  const label = platformLabels[platform]
  if (action === 'delete') {
    return `请人工进入${label}，按来源引用定位并核对目标记录后执行删除；本工具未执行该操作，完成情况须由你在来源中确认。`
  }
  if (locallyCorrected) {
    return `本地副本已标记为已修正；仍须人工进入${label}，按来源引用同步修正并确认结果，本工具未修改来源数据。`
  }
  if (action === 'correct') {
    return `请人工进入${label}，按来源引用核对事实、时间和上下文后执行修正；本工具未修改来源数据，结果须由你确认。`
  }
  return `请人工进入${label}，按来源引用复核该问题，再决定保留、修正或删除；本工具未删除或修改来源数据。`
}

const sourceFor = (record: MemoryRecord | undefined, recordId: string): CleanupSourceReference => ({
  recordId: inline(record?.id, recordId),
  platform: inline(record?.source?.platform, '未知来源'),
  uri: inline(record?.source?.uri, '未提供来源 URI'),
  locator: inline(record?.source?.locator, '无法定位'),
  revision: inline(record?.source?.revision, '未提供版本'),
})

/**
 * Builds a local plan only. A step records what the user still needs to do in
 * the named source; generating the plan never represents platform execution.
 */
export function buildCleanupChecklist(
  records: MemoryRecord[],
  issues: MemoryIssue[],
  generatedAt = new Date().toISOString(),
): CleanupChecklist {
  const recordsById = new Map(records.map((record) => [record.id, record]))
  const grouped = new Map<CleanupPlatform, CleanupStep[]>()
  const seen = new Set<string>()

  for (const issue of issues) {
    const action = actionFor(issue)
    if (!action) continue
    const locallyCorrected = (issue.disposition as string) === 'corrected'
    const sourceIds = issue.sourceIds.length ? issue.sourceIds : [`missing:${issue.id}`]

    for (const sourceId of sourceIds) {
      const uniqueId = `${issue.id}:${sourceId}`
      if (seen.has(uniqueId)) continue
      seen.add(uniqueId)

      const record = recordsById.get(sourceId)
      const platform = classifyCleanupPlatform(record)
      const step: CleanupStep = {
        id: uniqueId,
        issueId: issue.id,
        issueTitle: inline(issue.title, '未命名问题'),
        action,
        manual: true,
        status: 'pending-manual',
        localState: locallyCorrected ? 'corrected' : 'unchanged',
        instruction: instructionFor(action, platform, locallyCorrected),
        source: sourceFor(record, sourceId),
        relatedSourceIds: [...sourceIds],
      }
      grouped.set(platform, [...(grouped.get(platform) ?? []), step])
    }
  }

  const groups = platformOrder
    .filter((platform) => grouped.has(platform))
    .map((platform) => ({ platform, label: platformLabels[platform], steps: grouped.get(platform) ?? [] }))

  return {
    title: 'AI 记忆人工清理清单',
    generatedAt,
    execution: 'manual-only',
    boundary: '本清单只提供人工操作步骤；工具不会登录任何平台，也未执行任何删除或修正。',
    totalSteps: groups.reduce((total, group) => total + group.steps.length, 0),
    groups,
  }
}

const markdownCell = (value: string) => value.replace(/[`\r\n]/g, ' ').trim()

export function renderCleanupChecklistMarkdown(checklist: CleanupChecklist): string {
  const lines = [
    `# ${checklist.title}`,
    '',
    `> ${checklist.boundary}`,
    '',
    `生成时间：${markdownCell(checklist.generatedAt)}`,
    '',
  ]

  if (!checklist.groups.length) {
    lines.push('当前没有需要列入人工清理清单的问题。', '')
    return lines.join('\n')
  }

  for (const group of checklist.groups) {
    lines.push(`## ${group.label}`, '')
    for (const step of group.steps) {
      lines.push(
        `- [ ] **${step.action}** · ${markdownCell(step.issueTitle)}`,
        `  - 人工步骤：${markdownCell(step.instruction)}`,
        `  - 来源引用：${markdownCell(step.source.uri)} · ${markdownCell(step.source.locator)} · 版本 ${markdownCell(step.source.revision)}`,
        `  - 记录 ID：${markdownCell(step.source.recordId)}`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function buildCleanupChecklistMarkdown(
  records: MemoryRecord[],
  issues: MemoryIssue[],
  generatedAt = new Date().toISOString(),
): string {
  return renderCleanupChecklistMarkdown(buildCleanupChecklist(records, issues, generatedAt))
}
