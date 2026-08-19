import { describe, expect, it } from 'vitest'
import { buildContextPackage, buildMigrationMarkdown, sanitizeRecordForExport } from './exporter'
import type { MemoryRecord } from './types'

const record = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: 'record-1',
  type: 'fact',
  title: '普通记录',
  content: '普通内容',
  scope: 'global',
  source: { uri: 'file:///Users/example/memory.md', revision: '1', locator: 'L1', platform: '本地文件' },
  confidence: 0.8,
  sensitivity: 'public',
  tags: [],
  ...overrides,
})

describe('independent export safety boundary', () => {
  it('blocks a known secret even when the record is incorrectly marked public', () => {
    const leaked = 'sk-' + 'test_abcdefghijklmnop123456'
    const unsafe = record({ content: `misclassified ${leaked}` })
    expect(sanitizeRecordForExport(unsafe)).toBeNull()
    expect(JSON.stringify(buildContextPackage([unsafe], []))).not.toContain(leaked)
    expect(buildMigrationMarkdown([unsafe], [])).not.toContain(leaked)
  })

  it('blocks URL credentials even when the record is marked public', () => {
    const safe = sanitizeRecordForExport(record({
      content: '联系邮箱 demo@example.com',
      source: { uri: 'https://user:pass@example.com/memory?q=private#token', revision: '1', locator: 'L1' },
    }))
    expect(safe).toBeNull()
  })

  it('never exports records explicitly marked secret', () => {
    const unsafe = record({ sensitivity: 'secret', content: 'opaque-value-not-matched-by-regex' })
    expect(buildContextPackage([unsafe], []).items).toHaveLength(0)
  })

  it('exports safe records and inference/delete guidance without retaining local URL credentials', () => {
    const safe = record({
      observedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      tags: ['偏好'],
      source: { uri: 'https://example.com/memory?q=private#fragment', revision: '2', locator: 'L2' },
    })
    const issues = [
      { id: 'inference', kind: 'duplicate' as const, severity: 'low' as const, title: '近似重复', explanation: '人工确认', sourceIds: ['record-1'], detection: 'inference' as const, disposition: 'unreviewed' as const },
      { id: 'delete', kind: 'stale' as const, severity: 'medium' as const, title: '旧记录', explanation: '人工确认', sourceIds: ['record-1'], detection: 'rule' as const, disposition: 'suggest-delete' as const },
    ]
    const pkg = buildContextPackage([safe], issues, '2026-08-13T00:00:00.000Z')
    const output = JSON.stringify(pkg)
    expect(pkg.items).toHaveLength(1)
    expect(output).toContain('低置信度推断：近似重复')
    expect(output).not.toContain('q=private')
    expect(output).not.toContain('fragment')
    expect(buildMigrationMarkdown([safe], issues)).toContain('旧记录（回到对应来源人工处理）')
  })

  it('uses safe fallbacks for missing source and validity metadata', () => {
    const safe = record({ source: undefined, observedAt: undefined, expiresAt: undefined })
    const pkg = buildContextPackage([safe], [], '2026-08-13T00:00:00.000Z')
    expect(pkg.items[0]).toMatchObject({
      source: { uri: 'unknown://source', revision: 'unknown', locator: '无法定位', platform: '未知来源' },
      validity: { observedAt: '2026-08-13T00:00:00.000Z', expiresAt: null },
    })
  })
})
