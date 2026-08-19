import { describe, expect, it } from 'vitest'
import { applyCorrection, revisionsForRecord } from './corrections'
import { parseImport } from './importer'

describe('auditable corrections', () => {
  const [record] = parseImport(JSON.stringify([{ id: 'city', title: '居住城市', content: '住在上海', source: { uri: 'file:///memory.md', revision: 'a', locator: 'L1' } }]), 'memory.json')

  it('keeps before and after records with a reason', () => {
    const result = applyCorrection(record, { title: '居住城市', content: '已搬到杭州居住', scope: 'global', reason: '本人确认已迁居' }, '2026-08-12T10:00:00.000Z')
    expect(result.revision.before.content).toBe('住在上海')
    expect(result.revision.after.content).toBe('已搬到杭州居住')
    expect(result.record.source?.revision).toContain('local-correction')
    expect(revisionsForRecord([result.revision], 'city')).toHaveLength(1)
  })

  it('redacts secrets in corrected content and reason before history storage', () => {
    const key = 'sk-' + 'test_abcdefghijklmnopqrstuvwxyz7Qx'
    const result = applyCorrection(record, { title: '更新', content: `key ${key}`, scope: 'project', reason: `移除 ${key}` }, '2026-08-12T10:00:00.000Z')
    expect(result.record.sensitivity).toBe('secret')
    expect(JSON.stringify(result)).not.toContain('abcdefghijklmnopqrstuvwxyz7Qx')
  })

  it('requires a correction reason', () => {
    expect(() => applyCorrection(record, { title: '城市', content: '杭州', scope: 'global', reason: '  ' })).toThrow('修正原因')
  })

  it('recomputes sensitivity for the current version while preserving the secret before-state', () => {
    const [secret] = parseImport('密钥: sk-' + 'test_abcdefghijklmnopqrstuvwxyz7Qx', 'secret.txt')
    const result = applyCorrection(secret, { title: '密钥状态', content: '测试密钥已经撤销，不再保留任何值。', scope: 'project', reason: '确认已撤销' }, '2026-08-12T10:00:00.000Z')
    expect(result.record.sensitivity).toBe('public')
    expect(result.record.tags).not.toContain('API Key')
    expect(result.revision.before.sensitivity).toBe('secret')
  })
})
