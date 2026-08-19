import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildMemoryTimeline, SECRET_REVISION_DETAIL } from '../memory-timeline'
import { analyzeMemories } from '../analyzer'
import type { MemoryRecord, MemoryRevision, MemorySnapshot } from '../types'
import { MemoryWorkspace } from './MemoryWorkspace'

const ordinaryRecord: MemoryRecord = {
  id: 'zero-issue-record',
  type: 'preference',
  title: '零问题也必须可见',
  content: '用户偏好简洁回答，这条规范化记录没有命中任何问题。',
  scope: 'global',
  source: {
    uri: 'file:///fixtures/ordinary-memory.md',
    locator: 'L12-L14',
    platform: 'Local file',
    revision: 'rev-7',
  },
  observedAt: '2026-08-01T09:30:00.000Z',
  expiresAt: null,
  confidence: 0.92,
  sensitivity: 'internal',
  tags: ['preference'],
}

const correctedRecord: MemoryRecord = {
  ...ordinaryRecord,
  content: '用户偏好简洁且附带验收证据的回答。',
}

const revisions: MemoryRevision[] = [
  {
    id: 'revision-1',
    recordId: ordinaryRecord.id,
    changedAt: '2026-08-02T10:00:00.000Z',
    reason: '根据用户明确反馈修正',
    before: ordinaryRecord,
    after: correctedRecord,
  },
]

const snapshots: MemorySnapshot[] = [
  {
    id: 'snapshot-1',
    name: '首次导入快照',
    capturedAt: '2026-08-01T09:35:00.000Z',
    records: [ordinaryRecord],
  },
]

const renderWorkspace = (records: MemoryRecord[] = [ordinaryRecord]) =>
  renderToStaticMarkup(
    createElement(MemoryWorkspace, {
      records,
      revisions,
      snapshots,
      importedAt: '2026-08-01T09:35:00.000Z',
      onEdit: () => undefined,
    }),
  )

describe('all-memory and timeline workspace', () => {
  it('renders a normalized record even when it has zero issues', () => {
    expect(analyzeMemories([ordinaryRecord], {})).toEqual([])
    const html = renderWorkspace()
    expect(html).toContain('零问题也必须可见')
    expect(html).toContain('没有命中任何问题')
    expect(html).toContain('不会因“0 个问题”而隐藏记忆')
  })

  it('shows PRD record metadata, source revision, times, and the containing import snapshot', () => {
    const html = renderWorkspace()
    expect(html).toContain('<dt>类型</dt><dd>偏好</dd>')
    expect(html).toContain('<dt>作用域</dt><dd>全局</dd>')
    expect(html).toContain('<dt>置信度</dt><dd>92%</dd>')
    expect(html).toContain('<dt>敏感级别</dt><dd>内部</dd>')
    expect(html).toContain('<dt>标签</dt><dd>preference</dd>')
    expect(html).toContain('file:///fixtures/ordinary-memory.md')
    expect(html).toContain('L12-L14')
    expect(html).toContain('Local file')
    expect(html).toContain('rev-7')
    expect(html).toContain('首次导入快照')
    expect(html).toContain('2026')
  })

  it('builds and renders import, snapshot, and correction history', () => {
    const events = buildMemoryTimeline(
      [correctedRecord],
      revisions,
      snapshots,
      '2026-08-01T09:35:00.000Z',
    )
    expect(events.map(({ kind }) => kind).sort()).toEqual(['import', 'revision', 'snapshot'])
    const html = renderWorkspace([correctedRecord])
    expect(html).toContain('记忆变更与快照时间线')
    expect(html).toContain('根据用户明确反馈修正')
    expect(html).toContain('修正前')
    expect(html).toContain('修正后')
  })

  it('never renders secret record fields or secret revision payloads', () => {
    const rawSecret = ['sk', 'test', '1234567890abcdef'].join('-')
    const secretRecord: MemoryRecord = {
      ...ordinaryRecord,
      id: `secret-id-${rawSecret}`,
      title: `机密标题 ${rawSecret}`,
      content: `机密内容 ${rawSecret}`,
      source: {
        uri: `file:///private/${rawSecret}`,
        locator: `locator-${rawSecret}`,
        platform: `platform-${rawSecret}`,
        revision: `revision-${rawSecret}`,
      },
      sensitivity: 'secret',
      tags: [rawSecret],
    }
    const secretRevision: MemoryRevision = {
      id: 'secret-revision',
      recordId: secretRecord.id,
      changedAt: '2026-08-03T10:00:00.000Z',
      reason: `修正原因 ${rawSecret}`,
      before: secretRecord,
      after: { ...secretRecord, content: `修正后 ${rawSecret}` },
    }
    const html = renderToStaticMarkup(
      createElement(MemoryWorkspace, {
        records: [secretRecord],
        revisions: [secretRevision],
        snapshots: [{ ...snapshots[0], records: [secretRecord] }],
        importedAt: '2026-08-01T09:35:00.000Z',
        onEdit: () => undefined,
      }),
    )
    expect(html).not.toContain(rawSecret)
    expect(html).not.toContain('机密标题')
    expect(html).not.toContain('机密内容')
    expect(html).toContain('[secret 级别内容已隐藏]')
    expect(html).toContain('[secret 来源已隐藏]')
    expect(html).toContain('secret 已锁定')
    expect(html).toContain('disabled=""')
  })

  it('forces an opaque declared-secret revision reason to a fixed timeline placeholder', () => {
    const opaqueMarker = 'opaque-marker::ultraviolet-otter-47'
    const secretRecord: MemoryRecord = {
      ...ordinaryRecord,
      id: 'opaque-secret-record',
      sensitivity: 'secret',
    }
    const secretRevision: MemoryRevision = {
      id: 'opaque-secret-revision',
      recordId: secretRecord.id,
      changedAt: '2026-08-04T10:00:00.000Z',
      reason: opaqueMarker,
      before: secretRecord,
      after: { ...secretRecord, content: '更新后的声明 secret 内容' },
    }
    const timeline = buildMemoryTimeline(
      [secretRecord],
      [secretRevision],
      [{ ...snapshots[0], records: [secretRecord] }],
      '2026-08-01T09:35:00.000Z',
    )
    const serializedTimeline = JSON.stringify(timeline)
    const revisionEvent = timeline.find((event) => event.kind === 'revision')

    expect(revisionEvent?.detail).toBe(SECRET_REVISION_DETAIL)
    expect(serializedTimeline).not.toContain(opaqueMarker)

    const html = renderToStaticMarkup(
      createElement(MemoryWorkspace, {
        records: [secretRecord],
        revisions: [secretRevision],
        snapshots: [{ ...snapshots[0], records: [secretRecord] }],
        importedAt: '2026-08-01T09:35:00.000Z',
        onEdit: () => undefined,
      }),
    )
    expect(html).not.toContain(opaqueMarker)
    expect(html).toContain(SECRET_REVISION_DETAIL)
  })
})
