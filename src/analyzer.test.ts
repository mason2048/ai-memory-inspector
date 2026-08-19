import { describe, expect, it } from 'vitest'
import { analyzeMemories } from './analyzer'
import { parseImport } from './importer'
import { buildContextPackage } from './exporter'
import { containsPlainSecret } from './redaction'

describe('memory inspection P0 rules', () => {
  it('detects every fake key fixture and redacts it before returning records', () => {
    const fixtures = [
      'OpenAI: sk-' + 'test_abcdefghijklmnopqrstuvwxyz7Qx',
      'GitHub: ghp_' + 'abcdefghijklmnopqrstuvwxyz123456',
      'Google: AIza' + 'SyDUMMYONLYabcdefghijklmnopqrstu',
      'AWS: AKIA' + 'IOSFODNN7EXAMPLE',
    ]
    for (const [index, fixture] of fixtures.entries()) {
      const [record] = parseImport(fixture, `fixture-${index}.txt`)
      expect(record.sensitivity).toBe('secret')
      expect(record.content).not.toBe(fixture)
      expect(containsPlainSecret(record.content)).toBe(false)
      const issues = analyzeMemories([record])
      expect(issues.some((issue) => issue.severity === 'blocker' && issue.sourceIds.includes(record.id))).toBe(true)
    }
  })

  it('classifies an address change as a time-related conflict with both sources', () => {
    const records = parseImport(JSON.stringify({ items: [
      { id: 'old', content: '小林住在上海。', source: { uri: 'file:///old.md', revision: 'a', locator: 'L1' }, validity: { observedAt: '2025-01-01', confidence: 0.9 } },
      { id: 'new', content: '小林已搬到杭州居住。', source: { uri: 'file:///new.md', revision: 'b', locator: 'L2' }, validity: { observedAt: '2026-01-01', confidence: 0.9 } },
    ] }), 'context.json')
    const conflict = analyzeMemories(records).find((issue) => issue.kind === 'conflict')
    expect(conflict?.sourceIds).toEqual(['old', 'new'])
    expect(conflict?.title).toContain('上海 / 杭州')
    expect(conflict?.explanation).toContain('不会擅自')
  })

  it('detects all labeled hard city conflicts in the safety fixture', () => {
    const pairs = [['北京', '上海'], ['上海', '杭州'], ['广州', '深圳'], ['成都', '南京'], ['苏州', '武汉'], ['西安', '北京'], ['杭州', '广州'], ['深圳', '成都'], ['南京', '苏州'], ['武汉', '西安']]
    const detected = pairs.filter(([from, to], index) => {
      const records = parseImport(JSON.stringify([
        { id: `old-${index}`, content: `虚构用户住在${from}`, source: { uri: `file:///old-${index}`, revision: 'a', locator: 'L1' } },
        { id: `new-${index}`, content: `虚构用户搬到${to}居住`, source: { uri: `file:///new-${index}`, revision: 'b', locator: 'L2' } },
      ]), 'conflicts.json')
      return analyzeMemories(records).some((issue) => issue.kind === 'conflict')
    }).length
    expect(detected / pairs.length).toBeGreaterThanOrEqual(0.9)
  })

  it('detects duplicate, stale and unsourced records', () => {
    const records = parseImport(JSON.stringify([
      { id: 'a', type: 'project-status', content: '项目正在进行中。', observedAt: '2024-01-01', source: { uri: 'file:///a.md', revision: '1', locator: 'L1' } },
      { id: 'b', content: '喜欢简洁回答。', source: { uri: 'file:///b.md', revision: '1', locator: 'L2' } },
      { id: 'c', content: '喜欢简洁回答。', source: { uri: '', revision: '', locator: '' } },
    ]), 'memories.json')
    const issues = analyzeMemories(records, {}, new Date('2026-08-12'))
    expect(issues.some((issue) => issue.kind === 'stale' && issue.sourceIds.includes('a'))).toBe(true)
    expect(issues.some((issue) => issue.kind === 'duplicate' && issue.sourceIds.includes('b') && issue.sourceIds.includes('c'))).toBe(true)
    expect(issues.some((issue) => issue.kind === 'unsourced' && issue.sourceIds.includes('c'))).toBe(true)
    expect(issues.every((issue) => issue.sourceIds.length > 0)).toBe(true)
  })

  it('exports Context Package v0.1 without secret-level records or plaintext keys', () => {
    const records = parseImport(JSON.stringify({ items: [
      { id: 'secret', content: 'key is sk-' + 'test_abcdefghijklmnopqrstuvwxyz7Qx', source: { uri: 'file:///x', revision: '1', locator: 'L1' } },
      { id: 'safe', title: '偏好', content: '回答保持简洁', type: 'preference', source: { uri: 'file:///x', revision: '1', locator: 'L2' } },
    ] }), 'context.json')
    const pkg = buildContextPackage(records, analyzeMemories(records), '2026-08-12T00:00:00.000Z')
    const output = JSON.stringify(pkg)
    expect(pkg.schemaVersion).toBe('0.1')
    expect(pkg.items).toHaveLength(1)
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz7Qx')
    expect(containsPlainSecret(output)).toBe(false)
    expect(pkg.warnings[0]).toContain('排除了 1 条')
  })

  it('redacts sensitive strings from metadata as well as content', () => {
    const key = 'sk-' + 'test_abcdefghijklmnopqrstuvwxyz7Qx'
    const [record] = parseImport(JSON.stringify([{ id: key, title: key, content: '安全正文', tags: [key], source: { uri: `file:///${key}`, revision: key, locator: key, platform: key } }]), 'meta.json')
    expect(JSON.stringify(record)).not.toContain('abcdefghijklmnopqrstuvwxyz7Qx')
  })

  it('redacts password labels even when they follow Chinese text', () => {
    const [record] = parseImport('虚构测试密码: secret-pass-123', 'password.txt')
    expect(record.sensitivity).toBe('secret')
    expect(record.content).toContain('[已脱敏]')
    expect(JSON.stringify(record)).not.toContain('secret-pass-123')
    expect(analyzeMemories([record])[0]?.severity).toBe('blocker')
  })

  it('detects employer, role and polarity conflicts beyond residence', () => {
    const records = parseImport(JSON.stringify([
      { id: 'employer-a', title: '工作信息', content: '目前在甲公司工作', source: { uri: 'file:///a', revision: '1', locator: 'L1' } },
      { id: 'employer-b', title: '工作信息', content: '目前在乙公司工作', source: { uri: 'file:///b', revision: '1', locator: 'L2' } },
      { id: 'rule-a', title: '远程办公规则', content: '允许远程办公', source: { uri: 'file:///c', revision: '1', locator: 'L3' } },
      { id: 'rule-b', title: '远程办公规则', content: '禁止远程办公', source: { uri: 'file:///d', revision: '1', locator: 'L4' } },
    ]), 'conflicts.json')
    const conflicts = analyzeMemories(records).filter((issue) => issue.kind === 'conflict')
    expect(conflicts.some((issue) => issue.title.includes('雇主存在冲突'))).toBe(true)
    expect(conflicts.some((issue) => issue.title.includes('肯定/否定冲突'))).toBe(true)
  })

  it('keeps the supported 5,000-record analysis bounded', () => {
    const records = Array.from({ length: 5_000 }, (_, index) => ({
      id: `record-${index}`,
      type: 'fact' as const,
      title: `虚构记录 ${index}`,
      content: `完全虚构且互不相同的检查内容 ${index.toString(36)}`,
      scope: 'global' as const,
      source: { uri: `file:///fixture-${index}.md`, revision: '1', locator: `L${index + 1}` },
      confidence: 0.8,
      sensitivity: 'public' as const,
      tags: [],
    }))
    const startedAt = performance.now()
    const issues = analyzeMemories(records)
    expect(performance.now() - startedAt).toBeLessThan(2_000)
    expect(issues.length).toBeLessThanOrEqual(2_000)
  })

  it('groups repeated sensitive, duplicate, identity, and residence findings without an issue explosion', () => {
    const records = parseImport(JSON.stringify([
      { id: 'secret', content: '普通占位', sensitivity: 'secret' },
      { id: 'sensitive', content: '联系邮箱 demo@example.com' },
      { id: 'dup-a', content: '完全相同的偏好' },
      { id: 'dup-b', content: '完全相同的偏好' },
      { id: 'dup-c', content: '完全相同的偏好' },
      { id: 'city-a', content: '住在北京', observedAt: '2025-01-01' },
      { id: 'city-b', content: '已搬到上海居住', observedAt: '2026-01-01' },
      { id: 'name-a', content: '姓名是张三', observedAt: '2025-01-01' },
      { id: 'name-b', content: '姓名是李四', observedAt: '2026-01-01' },
    ]), 'groups.json')
    const issues = analyzeMemories(records)
    expect(issues.some((issue) => issue.severity === 'blocker')).toBe(true)
    expect(issues.some((issue) => issue.severity === 'high')).toBe(true)
    expect(issues.some((issue) => issue.kind === 'duplicate' && issue.sourceIds.length === 3)).toBe(true)
    expect(issues.some((issue) => issue.title.includes('姓名存在冲突'))).toBe(true)
    expect(issues.some((issue) => issue.title.includes('北京 / 上海'))).toBe(true)
  })
})
