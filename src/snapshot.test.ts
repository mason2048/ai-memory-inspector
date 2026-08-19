import { describe, expect, it } from 'vitest'
import { compareSnapshots, diffSnapshotRecordFields, summarizeSnapshotRecord } from './snapshot'
import type { MemoryRecord, MemorySnapshot } from './types'

const record = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: 'memory-1',
  type: 'fact',
  title: '工作城市',
  content: '住在上海',
  scope: 'global',
  source: {
    uri: 'file:///memory.md',
    revision: 'v1',
    locator: 'L1',
    platform: '本地 Markdown',
  },
  observedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  confidence: 0.9,
  sensitivity: 'public',
  tags: ['城市'],
  ...overrides,
})

describe('snapshot diff engine', () => {
  it('accepts the shared MemorySnapshot contract', () => {
    const before: MemorySnapshot = {
      id: 'snapshot-before',
      name: '导入前',
      capturedAt: '2026-08-11T00:00:00.000Z',
      records: [record()],
    }
    const after: MemorySnapshot = {
      id: 'snapshot-after',
      name: '导入后',
      capturedAt: '2026-08-12T00:00:00.000Z',
      records: [record({ content: '住在杭州' })],
    }

    const diff = compareSnapshots(before, after)

    expect(diff.summary).toMatchObject({ modified: 1, totalBefore: 1, totalAfter: 1 })
    expect(diff.modified[0].changes).toContainEqual({
      field: 'content',
      before: '住在上海',
      after: '住在杭州',
    })
  })

  it('reports added, deleted, modified, and unchanged records in one comparison', () => {
    const unchanged = record({ id: 'unchanged', title: '回答偏好', content: '回答保持简洁' })
    const changedBefore = record({ id: 'changed', content: '项目进行中', confidence: 0.6 })
    const changedAfter = record({ id: 'changed', content: '项目已完成', confidence: 0.95 })
    const removed = record({
      id: 'removed',
      content: '旧项目状态',
      source: { uri: 'file:///removed.md', revision: '1', locator: 'L1' },
    })
    const added = record({
      id: 'added',
      content: '新的偏好',
      source: { uri: 'file:///added.md', revision: '1', locator: 'L1' },
    })

    const diff = compareSnapshots(
      [unchanged, changedBefore, removed],
      [changedAfter, unchanged, added],
    )

    expect(diff.summary).toEqual({
      added: 1,
      deleted: 1,
      modified: 1,
      unchanged: 1,
      totalBefore: 3,
      totalAfter: 3,
    })
    expect(diff.added[0].after.id).toBe('added')
    expect(diff.deleted[0].before.id).toBe('removed')
    expect(diff.modified[0]).toMatchObject({
      matchedBy: 'id',
      before: { id: 'changed', content: '项目进行中' },
      after: { id: 'changed', content: '项目已完成' },
    })
    expect(diff.modified[0].changes).toEqual([
      { field: 'content', before: '项目进行中', after: '项目已完成' },
      { field: 'confidence', before: 0.6, after: 0.95 },
    ])
    expect(diff.unchanged[0].before.id).toBe('unchanged')
  })

  it('falls back to source URI plus locator when a stable ID changes', () => {
    const before = record({ id: 'generated-old', title: '原始标题' })
    const after = record({ id: 'generated-new', title: '修正标题' })

    const diff = compareSnapshots([before], [after])

    expect(diff.summary.modified).toBe(1)
    expect(diff.summary.added).toBe(0)
    expect(diff.summary.deleted).toBe(0)
    expect(diff.modified[0].matchedBy).toBe('source')
    expect(diff.modified[0].changes.map((change) => change.field)).toEqual(['id', 'title'])
  })

  it('gives a stable ID priority over a colliding source fallback', () => {
    const before = [
      record({ id: 'stable', source: { uri: 'file:///old.md', revision: '1', locator: 'L1' } }),
      record({ id: 'other', source: { uri: 'file:///shared.md', revision: '1', locator: 'L2' } }),
    ]
    const after = [
      record({ id: 'stable', source: { uri: 'file:///shared.md', revision: '2', locator: 'L2' } }),
      record({ id: 'renamed', source: { uri: 'file:///old.md', revision: '2', locator: 'L1' } }),
    ]

    const diff = compareSnapshots(before, after)

    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0]).toMatchObject({ matchedBy: 'id', before: { id: 'stable' }, after: { id: 'stable' } })
    expect(diff.deleted.map((entry) => entry.before.id)).toEqual(['other'])
    expect(diff.added.map((entry) => entry.after.id)).toEqual(['renamed'])
  })

  it('requires both a non-empty URI and locator for source fallback', () => {
    const before = record({ id: '', source: { uri: 'file:///same.md', revision: '1', locator: '' } })
    const after = record({ id: '', source: { uri: 'file:///same.md', revision: '2', locator: '' } })

    const diff = compareSnapshots([before], [after])

    expect(diff.summary).toMatchObject({ added: 1, deleted: 1, modified: 0, unchanged: 0 })
  })

  it('returns field-level source and tag changes', () => {
    const before = record()
    const after = record({
      source: { uri: 'file:///memory.md', revision: 'v2', locator: 'L1', platform: 'Codex' },
      tags: ['城市', '已确认'],
    })

    expect(diffSnapshotRecordFields(before, after)).toEqual([
      { field: 'source.revision', before: 'v1', after: 'v2' },
      { field: 'source.platform', before: '本地 Markdown', after: 'Codex' },
      { field: 'tags', before: ['城市'], after: ['城市', '已确认'] },
    ])
  })

  it('never copies declared secret payloads into summaries or serialized diff output', () => {
    const secret = 'TOP-SECRET-NON-PATTERN-94731'
    const before = record({
      id: `id-${secret}`,
      title: secret,
      content: `password is ${secret}`,
      source: { uri: `file:///${secret}`, revision: secret, locator: secret, platform: secret },
      sensitivity: 'secret',
      tags: [secret],
    })
    const after = record({
      ...before,
      content: `${secret}-changed`,
      confidence: 0.99,
    })

    const summary = summarizeSnapshotRecord(before)
    const diff = compareSnapshots([before], [after])
    const serialized = JSON.stringify({ summary, diff })

    expect(serialized).not.toContain(secret)
    expect(summary).toMatchObject({
      id: expect.stringMatching(/^secret-/),
      sensitivity: 'secret',
    })
    expect(summary.title).toContain('已隐藏')
    expect(diff.modified[0].changes).toEqual([
      { field: 'content', before: expect.stringContaining('已隐藏'), after: expect.stringContaining('已隐藏') },
      { field: 'confidence', before: 0.9, after: 0.99 },
    ])
  })

  it('keeps both sides hidden when a matched record changes out of secret classification', () => {
    const secret = 'CLASSIFIED-PAYLOAD-52830'
    const before = record({
      content: secret,
      sensitivity: 'secret',
    })
    const after = record({
      content: `${secret}-reclassified`,
      sensitivity: 'public',
    })

    const serialized = JSON.stringify(compareSnapshots([before], [after]))

    expect(serialized).not.toContain(secret)
    expect(serialized).toContain('secret 级别内容已隐藏')
  })

  it('redacts accidentally embedded key patterns even on non-secret summaries', () => {
    const key = 'sk-' + 'test_abcdefghijklmnopqrstuvwxyz7Qx'
    const summary = summarizeSnapshotRecord(record({
      title: `调试 ${key}`,
      content: `临时密钥 ${key}`,
      source: { uri: `file:///${key}`, revision: 'v1', locator: 'L1' },
    }))

    expect(JSON.stringify(summary)).not.toContain('abcdefghijklmnopqrstuvwxyz7Qx')
  })
})
