import { describe, expect, it } from 'vitest'
import { parseImport } from './importer'

describe('local import normalization', () => {
  it('imports Markdown/TXT fragments with traceable local source placeholders', () => {
    const records = parseImport('- 喜欢简洁回答\n- 项目必须离线运行', 'memory.md')
    expect(records).toHaveLength(2)
    expect(records[0].source?.uri).toBe('file:///memory.md')
    expect(records[0].source?.locator).toBe('片段 1')
    expect(records[1].type).toBe('instruction')
  })

  it('accepts Context Package and ignores unknown fields', () => {
    const records = parseImport(JSON.stringify({
      schemaVersion: '0.1',
      futureField: true,
      items: [{ id: 'one', type: 'fact', title: '城市', content: '住在苏州', scope: 'global', source: { uri: 'file:///memory.md', revision: 'abc', locator: 'L2' }, validity: { observedAt: '2026-01-01', expiresAt: null, confidence: 0.8 }, sensitivity: 'internal', unknown: 'ignored' }],
    }), 'context-package.json')
    expect(records[0]).toMatchObject({ id: 'one', title: '城市', sensitivity: 'internal', confidence: 0.8 })
  })

  it('fails safely for malformed JSON files', () => {
    expect(() => parseImport('{nope', 'broken.json')).toThrow('JSON 文件无法解析')
  })

  it('unconditionally hides every user-declared secret field even without a detector match', () => {
    const rawSecret = 'PRIVATE-NON-PATTERN-VALUE-7419'
    const records = parseImport(JSON.stringify({
      items: [{
        id: rawSecret,
        title: rawSecret,
        content: rawSecret,
        tags: [rawSecret],
        sensitivity: 'secret',
        source: { uri: `file:///${rawSecret}.md`, revision: rawSecret, locator: rawSecret, platform: rawSecret },
      }],
    }), 'declared-secret.json')
    expect(records[0].sensitivity).toBe('secret')
    expect(JSON.stringify(records)).not.toContain(rawSecret)
    expect(records[0]).toMatchObject({ title: '[secret 记录已隐藏]', content: '[secret 内容已隐藏]' })
  })

  it('keeps duplicate imported ids distinct to avoid record overwrite', () => {
    const records = parseImport(JSON.stringify([
      { id: 'same', content: '第一条' },
      { id: 'same', content: '第二条' },
    ]), 'duplicates.json')
    expect(records.map((record) => record.id)).toEqual(['same', 'same-2'])
  })

  it('removes bidi controls and treats URL userinfo as a secret boundary', () => {
    const [record] = parseImport(JSON.stringify([{ content: '正常\u202E伪装', source: { uri: 'https://user:password@example.com/memory', revision: '1', locator: 'L1' } }]), 'uri.json')
    expect(record.sensitivity).toBe('secret')
    expect(JSON.stringify(record)).not.toContain('password')
    expect(JSON.stringify(record)).not.toContain('\u202E')
  })
})
