import { describe, expect, it } from 'vitest'
import {
  CustomRuleValidationError,
  MAX_REGEX_LENGTH,
  parseCustomRuleSet,
  runCustomRules,
  validateCustomRuleSet,
  type CustomRule,
  type CustomRuleSet,
} from './custom-rules'
import type { MemoryRecord } from './types'

const record = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: 'memory-1',
  type: 'project-status',
  title: '演示项目已归档',
  content: 'ALPHA-204 已归档，请勿作为当前状态。',
  scope: 'project',
  source: { uri: 'file:///memory.md', revision: 'abc123', locator: 'L8', platform: 'Codex' },
  observedAt: '2024-02-29',
  expiresAt: null,
  confidence: 0.8,
  sensitivity: 'internal',
  tags: ['archive', 'demo'],
  ...overrides,
})

const rule = (overrides: Partial<CustomRule> = {}): CustomRule => ({
  id: 'archived-project',
  enabled: true,
  match: { operator: 'contains', field: 'content', value: '已归档', caseSensitive: false },
  severity: 'medium',
  kind: 'stale',
  title: '可能是旧项目记录',
  explanation: '正文包含归档标记，请回到来源核实。',
  ...overrides,
})

const ruleSet = (...rules: CustomRule[]): CustomRuleSet => ({ schemaVersion: '1', rules })

describe('custom rule JSON validation', () => {
  it('imports the data-only allow-listed format and fills safe optional defaults', () => {
    const imported = parseCustomRuleSet(JSON.stringify({
      schemaVersion: '1',
      rules: [{
        id: 'archive-marker',
        enabled: true,
        match: { operator: 'contains', field: 'tags', value: 'archive' },
        severity: 'low',
        kind: 'stale',
        title: '归档标签',
        explanation: '请人工确认。',
      }],
    }))
    expect(imported.rules[0].match).toEqual({ operator: 'contains', field: 'tags', value: 'archive', caseSensitive: false })
  })

  it('rejects executable or unknown properties instead of retaining them', () => {
    const malicious = {
      schemaVersion: '1',
      eval: 'stealSecrets()',
      rules: [{ ...rule(), script: 'globalThis.fetch("https://example.invalid")' }],
    }
    const result = validateCustomRuleSet(malicious)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/eval|script/)
  })

  it('rejects malformed input, duplicate IDs, invalid dates and excessive rule payloads', () => {
    expect(() => parseCustomRuleSet('{broken')).toThrow(CustomRuleValidationError)
    expect(validateCustomRuleSet(ruleSet(rule(), rule())).ok).toBe(false)
    expect(validateCustomRuleSet(ruleSet(rule({
      match: { operator: 'date-before', field: 'observedAt', value: '2025-02-30' },
    }))).ok).toBe(false)
    expect(validateCustomRuleSet({ schemaVersion: '1', rules: Array.from({ length: 101 }, (_, index) => rule({ id: `r-${index}` })) }).ok).toBe(false)
  })

  it('rejects secrets embedded in rule display or match strings', () => {
    const result = validateCustomRuleSet(ruleSet(rule({
      title: '包含 sk-' + 'test_abcdefghijklmnopqrstuvwxyz7Qx',
    })))
    expect(result.ok).toBe(false)
  })

  it('strictly rejects long or dangerous regular expressions and unsafe flags', () => {
    const unsafePatterns = [
      'a+'.padEnd(MAX_REGEX_LENGTH + 1, 'a'),
      '(a+)+$',
      '(a|aa)*$',
      '(?=secret)secret',
      '(a)\\1',
      'a{1,}',
      '(ab){2,8}',
      'a{1,33}',
    ]
    for (const [index, pattern] of unsafePatterns.entries()) {
      const result = validateCustomRuleSet(ruleSet(rule({
        id: `unsafe-${index}`,
        match: { operator: 'regex', field: 'content', pattern, flags: '' },
      })))
      expect(result.ok, pattern).toBe(false)
    }
    expect(validateCustomRuleSet({
      schemaVersion: '1',
      rules: [{ ...rule(), match: { operator: 'regex', field: 'content', pattern: 'safe', flags: 'g' } }],
    }).ok).toBe(false)
  })
})

describe('custom rule execution', () => {
  it('supports contains across normalized record and source fields', () => {
    const issues = runCustomRules([record()], ruleSet(
      rule({ id: 'content', match: { operator: 'contains', field: 'content', value: 'alpha-204', caseSensitive: false } }),
      rule({ id: 'platform', match: { operator: 'contains', field: 'source.platform', value: 'Codex', caseSensitive: true } }),
      rule({ id: 'wrong-case', match: { operator: 'contains', field: 'content', value: 'alpha-204', caseSensitive: true } }),
    ))
    expect(issues.map((issue) => issue.sourceIds)).toEqual([['memory-1'], ['memory-1']])
    expect(issues.every((issue) => issue.detection === 'rule')).toBe(true)
  })

  it('supports a bounded regex without executing code', () => {
    const issues = runCustomRules([record()], ruleSet(rule({
      match: { operator: 'regex', field: 'content', pattern: 'ALPHA-[0-9]{3}', flags: '' },
    })))
    expect(issues).toHaveLength(1)
    expect(issues[0].sourceIds).toEqual(['memory-1'])
  })

  it('supports date-before with strict dates and excludes the boundary', () => {
    const rules = ruleSet(rule({
      match: { operator: 'date-before', field: 'observedAt', value: '2024-03-01' },
    }))
    expect(runCustomRules([record()], rules)).toHaveLength(1)
    expect(runCustomRules([record({ observedAt: '2024-03-01' })], rules)).toHaveLength(0)
    expect(runCustomRules([record({ observedAt: 'not-a-date' })], rules)).toHaveLength(0)
  })

  it('does not run disabled rules and preserves an existing local disposition', () => {
    const disabled = runCustomRules([record()], ruleSet(rule({ enabled: false })))
    expect(disabled).toEqual([])

    const first = runCustomRules([record()], ruleSet(rule()))
    const retained = runCustomRules([record()], ruleSet(rule()), { [first[0].id]: 'keep' })
    expect(retained[0].disposition).toBe('keep')
  })

  it('only emits issues that reference a real, non-empty input record ID', () => {
    const issues = runCustomRules([
      record({ id: '' }),
      record({ id: 'source-a' }),
      record({ id: 'source-b', content: '没有匹配内容' }),
    ], ruleSet(rule()))
    expect(issues).toHaveLength(1)
    expect(issues[0].sourceIds).toEqual(['source-a'])
    expect(issues.every((issue) => issue.sourceIds.length > 0)).toBe(true)
  })

  it('revalidates programmatically constructed input before execution', () => {
    const bypassedType = ruleSet(rule({
      match: { operator: 'regex', field: 'content', pattern: '(a+)+$', flags: '' },
    }))
    expect(() => runCustomRules([record()], bypassedType)).toThrow(CustomRuleValidationError)
  })
})
