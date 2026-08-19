import { describe, expect, it } from 'vitest'
import { buildCleanupChecklist, buildCleanupChecklistMarkdown, classifyCleanupPlatform } from './cleanup'
import type { MemoryIssue, MemoryRecord } from './types'

const record = (id: string, platform?: string, uri = `https://example.test/${id}`): MemoryRecord => ({
  id,
  type: 'fact',
  title: `记录 ${id}`,
  content: `虚构内容 ${id}`,
  scope: 'global',
  source: { platform, uri, locator: `位置 ${id}`, revision: `rev-${id}` },
  confidence: 0.8,
  sensitivity: 'public',
  tags: [],
})

const issue = (
  id: string,
  sourceIds: string[],
  disposition: string,
  kind: MemoryIssue['kind'] = 'duplicate',
): MemoryIssue => ({
  id,
  kind,
  severity: 'medium',
  title: `问题 ${id}`,
  explanation: '仅用于自动化测试的虚构问题。',
  sourceIds,
  detection: 'rule',
  disposition: disposition as MemoryIssue['disposition'],
})

describe('manual cleanup checklist', () => {
  it('groups ChatGPT, Claude, Codex, local files and unknown sources in stable order', () => {
    const records = [
      record('chatgpt', 'ChatGPT 导出', 'file:///exports/chatgpt.json'),
      record('claude', 'Claude Memory'),
      record('codex', 'Codex 上下文包'),
      record('local', '本地 Markdown', 'file:///notes/memory.md'),
      record('other', '自建助手', 'https://assistant.example/memory'),
    ]
    const issues = [
      issue('delete-chatgpt', ['chatgpt'], 'suggest-delete'),
      issue('correct-claude', ['claude'], 'corrected'),
      issue('correct-codex', ['codex'], 'unreviewed', 'stale'),
      issue('review-local', ['local'], 'unreviewed'),
      issue('review-other', ['other'], 'unreviewed', 'sensitive'),
    ]

    const checklist = buildCleanupChecklist(records, issues, '2026-08-12T00:00:00.000Z')

    expect(checklist.groups.map((group) => group.platform)).toEqual(['chatgpt', 'claude', 'codex', 'local', 'other'])
    expect(checklist.groups.map((group) => group.label)).toEqual(['ChatGPT', 'Claude', 'Codex', '本地文件', '未知/其他'])
    expect(checklist.groups.flatMap((group) => group.steps).map((step) => step.action)).toEqual(['delete', 'correct', 'correct', 'review', 'review'])
    expect(checklist.execution).toBe('manual-only')
    expect(checklist.totalSteps).toBe(5)
  })

  it('makes every step explicitly manual and preserves a complete source reference', () => {
    const source = record('source', 'ChatGPT', 'https://chatgpt.example/export/1')
    const [step] = buildCleanupChecklist(
      [source],
      [issue('delete', ['source'], 'suggest-delete')],
      '2026-08-12T00:00:00.000Z',
    ).groups[0].steps

    expect(step).toMatchObject({
      action: 'delete',
      manual: true,
      status: 'pending-manual',
      localState: 'unchanged',
      source: {
        recordId: 'source',
        platform: 'ChatGPT',
        uri: 'https://chatgpt.example/export/1',
        locator: '位置 source',
        revision: 'rev-source',
      },
    })
    expect(step.instruction).toContain('请人工')
    expect(step.instruction).toContain('本工具未执行')
    expect(step.instruction).not.toMatch(/删除成功|已经删除|已为你删除|已从.+删除/)
  })

  it('marks corrected issues as locally corrected while requiring manual platform sync', () => {
    const [step] = buildCleanupChecklist(
      [record('claude', 'Claude')],
      [issue('corrected', ['claude'], 'corrected', 'conflict')],
    ).groups[0].steps

    expect(step.action).toBe('correct')
    expect(step.localState).toBe('corrected')
    expect(step.instruction).toContain('本地副本已标记为已修正')
    expect(step.instruction).toContain('仍须人工')
    expect(step.instruction).toContain('本工具未修改来源数据')
  })

  it('creates one platform-specific step per cited source for a cross-platform issue', () => {
    const checklist = buildCleanupChecklist(
      [record('old', 'ChatGPT'), record('new', 'Claude')],
      [issue('conflict', ['old', 'new'], 'unreviewed', 'conflict')],
    )
    const steps = checklist.groups.flatMap((group) => group.steps)

    expect(steps).toHaveLength(2)
    expect(steps.every((step) => step.action === 'correct')).toBe(true)
    expect(steps.map((step) => step.source.recordId)).toEqual(['old', 'new'])
    expect(steps.every((step) => step.relatedSourceIds.join(',') === 'old,new')).toBe(true)
  })

  it('omits keep and ignore dispositions, but retains unresolved items for manual review', () => {
    const records = [record('kept'), record('ignored'), record('pending')]
    const checklist = buildCleanupChecklist(records, [
      issue('kept', ['kept'], 'keep'),
      issue('ignored', ['ignored'], 'ignore'),
      issue('pending', ['pending'], 'unreviewed', 'duplicate'),
    ])

    expect(checklist.totalSteps).toBe(1)
    expect(checklist.groups[0].steps[0]).toMatchObject({ issueId: 'pending', action: 'review' })
  })

  it('uses the unknown group and an explicit fallback citation when a record is missing', () => {
    const checklist = buildCleanupChecklist([], [issue('dangling', ['not-imported'], 'suggest-delete')])
    const [group] = checklist.groups
    const [step] = group.steps

    expect(group.platform).toBe('other')
    expect(step.source).toEqual({
      recordId: 'not-imported',
      platform: '未知来源',
      uri: '未提供来源 URI',
      locator: '无法定位',
      revision: '未提供版本',
    })
  })

  it('classifies an explicit AI platform before considering its local export URI', () => {
    expect(classifyCleanupPlatform(record('a', 'OpenAI ChatGPT', 'file:///chatgpt.json'))).toBe('chatgpt')
    expect(classifyCleanupPlatform(record('b', 'Anthropic Claude', 'file:///claude.json'))).toBe('claude')
    expect(classifyCleanupPlatform(record('c', undefined, 'file:///memory.txt'))).toBe('local')
    expect(classifyCleanupPlatform(record('d', undefined, 'https://unknown.example/memory'))).toBe('other')
  })

  it('renders action types and source citations without claiming platform execution', () => {
    const markdown = buildCleanupChecklistMarkdown(
      [record('chatgpt', 'ChatGPT', 'https://chatgpt.example/memory/7')],
      [issue('delete', ['chatgpt'], 'suggest-delete')],
      '2026-08-12T00:00:00.000Z',
    )

    expect(markdown).toContain('# AI 记忆人工清理清单')
    expect(markdown).toContain('**delete**')
    expect(markdown).toContain('来源引用：https://chatgpt.example/memory/7 · 位置 chatgpt · 版本 rev-chatgpt')
    expect(markdown).toContain('工具不会登录任何平台，也未执行任何删除或修正')
    expect(markdown).not.toMatch(/删除成功|已经删除|已为你删除|已从.+删除/)
  })
})
