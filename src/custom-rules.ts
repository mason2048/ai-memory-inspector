import type { Disposition, IssueKind, MemoryIssue, MemoryRecord, Severity } from './types'
import { redactText } from './redaction'

/**
 * Custom rules are deliberately data-only. The importer rebuilds every accepted
 * object from an allow-list and never evaluates functions, expressions or code.
 *
 * JSON example:
 * {
 *   "schemaVersion": "1",
 *   "rules": [{
 *     "id": "old-project-note",
 *     "enabled": true,
 *     "match": { "operator": "contains", "field": "content", "value": "已归档" },
 *     "severity": "low",
 *     "kind": "stale",
 *     "title": "可能是旧项目记录",
 *     "explanation": "正文包含已归档，请回到来源核实。"
 *   }]
 * }
 */

export const CUSTOM_RULE_SCHEMA_VERSION = '1' as const
export const MAX_CUSTOM_RULES = 100
export const MAX_REGEX_LENGTH = 128
export const MAX_RULE_JSON_LENGTH = 256_000
export const MAX_MATCH_INPUT_LENGTH = 50_000

export type CustomRuleTextField =
  | 'title'
  | 'content'
  | 'tags'
  | 'type'
  | 'scope'
  | 'sensitivity'
  | 'source.uri'
  | 'source.revision'
  | 'source.locator'
  | 'source.platform'

export type CustomRuleDateField = 'observedAt' | 'expiresAt'

export interface ContainsMatch {
  operator: 'contains'
  field: CustomRuleTextField
  value: string
  caseSensitive: boolean
}

export interface RegexMatch {
  operator: 'regex'
  field: CustomRuleTextField
  pattern: string
  flags: '' | 'i'
}

export interface DateBeforeMatch {
  operator: 'date-before'
  field: CustomRuleDateField
  /** ISO 8601 calendar date or timestamp with an explicit timezone. */
  value: string
}

export type CustomRuleMatch = ContainsMatch | RegexMatch | DateBeforeMatch

export interface CustomRule {
  id: string
  enabled: boolean
  match: CustomRuleMatch
  severity: Severity
  kind: IssueKind
  title: string
  explanation: string
}

export interface CustomRuleSet {
  schemaVersion: typeof CUSTOM_RULE_SCHEMA_VERSION
  rules: CustomRule[]
}

export type CustomRuleValidationResult =
  | { ok: true; value: CustomRuleSet; errors: [] }
  | { ok: false; errors: string[] }

export class CustomRuleValidationError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(`自定义规则无效：${errors.join('；')}`)
    this.name = 'CustomRuleValidationError'
    this.errors = [...errors]
  }
}

const TEXT_FIELDS = new Set<CustomRuleTextField>([
  'title',
  'content',
  'tags',
  'type',
  'scope',
  'sensitivity',
  'source.uri',
  'source.revision',
  'source.locator',
  'source.platform',
])
const DATE_FIELDS = new Set<CustomRuleDateField>(['observedAt', 'expiresAt'])
const SEVERITIES = new Set<Severity>(['blocker', 'high', 'medium', 'low'])
const ISSUE_KINDS = new Set<IssueKind>(['sensitive', 'conflict', 'stale', 'duplicate', 'unsourced'])
const RULE_KEYS = new Set(['id', 'enabled', 'match', 'severity', 'kind', 'title', 'explanation'])

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const unknownKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>) =>
  Object.keys(value).filter((key) => !allowed.has(key))

const isSafeDisplayText = (value: unknown, maxLength: number) =>
  typeof value === 'string'
  && value.trim().length > 0
  && value.length <= maxLength
  && !/[\u0000-\u001f\u007f]/.test(value)
  && redactText(value).text === value

const isValidIsoDate = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1000) return false
  const calendarCheck = new Date(Date.UTC(year, month - 1, day))
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day) return false
  return Number.isFinite(Date.parse(value))
}

/**
 * JavaScript has no native regular-expression timeout. To keep imported rules
 * safe offline, regex support is intentionally conservative: no lookarounds,
 * backreferences or unbounded repetition, and bounded repetition is capped.
 */
function regexSafetyError(pattern: string): string | null {
  if (!pattern.length) return 'pattern 不能为空'
  if (pattern.length > MAX_REGEX_LENGTH) return `pattern 不能超过 ${MAX_REGEX_LENGTH} 个字符`
  if (/[\u0000-\u001f\u007f]/.test(pattern)) return 'pattern 不能包含控制字符'

  let escaped = false
  let inClass = false
  let groupDepth = 0
  let groupCount = 0
  let alternatives = 0
  let quantifiers = 0

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]

    if (escaped) {
      if (!inClass && /[1-9]/.test(character)) return 'pattern 不允许反向引用'
      if (!inClass && character === 'k' && pattern[index + 1] === '<') return 'pattern 不允许命名反向引用'
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '[' && !inClass) {
      inClass = true
      continue
    }
    if (character === ']' && inClass) {
      inClass = false
      continue
    }
    if (inClass) continue

    if (character === '(') {
      groupDepth += 1
      groupCount += 1
      if (groupDepth > 4 || groupCount > 12) return 'pattern 的分组过于复杂'
      if (pattern[index + 1] === '?') {
        if (pattern[index + 2] !== ':') return 'pattern 不允许前后查找、命名分组或内联选项'
        index += 2
      }
      continue
    }
    if (character === ')') {
      groupDepth -= 1
      if (groupDepth < 0) return 'pattern 的分组不完整'
      continue
    }
    if (character === '|') {
      alternatives += 1
      if (alternatives > 8) return 'pattern 的分支过多'
      continue
    }
    if (character === '*' || character === '+') return 'pattern 不允许 * 或 + 等无界重复'
    if (character === '?') {
      quantifiers += 1
      if (quantifiers > 8) return 'pattern 的重复项过多'
      const previous = pattern[index - 1]
      if (!previous || '(|?*+{'.includes(previous)) return 'pattern 包含叠加或无目标的重复符'
      continue
    }
    if (character === '{') {
      const bounded = /^\{(\d{1,2})(?:,(\d{1,2}))?\}/.exec(pattern.slice(index))
      if (!bounded) return 'pattern 只允许上限明确的 {n} 或 {n,m} 重复'
      const minimum = Number(bounded[1])
      const maximum = Number(bounded[2] ?? bounded[1])
      if (minimum > maximum || maximum > 32) return 'pattern 的重复上限必须不超过 32 且不小于下限'
      if (pattern[index - 1] === ')') return 'pattern 不允许重复整个分组'
      quantifiers += 1
      if (quantifiers > 8) return 'pattern 的重复项过多'
      index += bounded[0].length - 1
    }
  }

  if (escaped || inClass || groupDepth !== 0) return 'pattern 的转义、字符组或分组不完整'
  try {
    // Compilation is validation only; execution happens after the same safety check.
    new RegExp(pattern)
  } catch {
    return 'pattern 不是有效的正则表达式'
  }
  return null
}

function validateMatch(input: unknown, path: string, errors: string[]): CustomRuleMatch | null {
  if (!isPlainObject(input)) {
    errors.push(`${path} 必须是对象`)
    return null
  }
  const operator = input.operator
  if (operator === 'contains') {
    const extras = unknownKeys(input, new Set(['operator', 'field', 'value', 'caseSensitive']))
    if (extras.length) errors.push(`${path} 包含不允许的字段：${extras.join(', ')}`)
    if (!TEXT_FIELDS.has(input.field as CustomRuleTextField)) errors.push(`${path}.field 不是允许的文本字段`)
    if (!isSafeDisplayText(input.value, 256)) errors.push(`${path}.value 必须是 1-256 个无控制字符的文本`)
    if (input.caseSensitive !== undefined && typeof input.caseSensitive !== 'boolean') errors.push(`${path}.caseSensitive 必须是布尔值`)
    if (extras.length || !TEXT_FIELDS.has(input.field as CustomRuleTextField) || !isSafeDisplayText(input.value, 256) || (input.caseSensitive !== undefined && typeof input.caseSensitive !== 'boolean')) return null
    return {
      operator,
      field: input.field as CustomRuleTextField,
      value: input.value as string,
      caseSensitive: input.caseSensitive === true,
    }
  }
  if (operator === 'regex') {
    const extras = unknownKeys(input, new Set(['operator', 'field', 'pattern', 'flags']))
    if (extras.length) errors.push(`${path} 包含不允许的字段：${extras.join(', ')}`)
    if (!TEXT_FIELDS.has(input.field as CustomRuleTextField)) errors.push(`${path}.field 不是允许的文本字段`)
    const patternError = typeof input.pattern === 'string' ? regexSafetyError(input.pattern) : 'pattern 必须是字符串'
    if (patternError) errors.push(`${path}.${patternError}`)
    if (input.flags !== undefined && input.flags !== '' && input.flags !== 'i') errors.push(`${path}.flags 只允许空字符串或 i`)
    if (extras.length || !TEXT_FIELDS.has(input.field as CustomRuleTextField) || patternError || (input.flags !== undefined && input.flags !== '' && input.flags !== 'i')) return null
    return {
      operator,
      field: input.field as CustomRuleTextField,
      pattern: input.pattern as string,
      flags: input.flags === 'i' ? 'i' : '',
    }
  }
  if (operator === 'date-before') {
    const extras = unknownKeys(input, new Set(['operator', 'field', 'value']))
    if (extras.length) errors.push(`${path} 包含不允许的字段：${extras.join(', ')}`)
    if (!DATE_FIELDS.has(input.field as CustomRuleDateField)) errors.push(`${path}.field 只能是 observedAt 或 expiresAt`)
    if (typeof input.value !== 'string' || !isValidIsoDate(input.value)) errors.push(`${path}.value 必须是有效的 ISO 8601 日期或带时区时间`)
    if (extras.length || !DATE_FIELDS.has(input.field as CustomRuleDateField) || typeof input.value !== 'string' || !isValidIsoDate(input.value)) return null
    return { operator, field: input.field as CustomRuleDateField, value: input.value }
  }
  errors.push(`${path}.operator 必须是 contains、regex 或 date-before`)
  return null
}

export function validateCustomRuleSet(input: unknown): CustomRuleValidationResult {
  const errors: string[] = []
  if (!isPlainObject(input)) return { ok: false, errors: ['规则集必须是 JSON 对象'] }

  const topLevelExtras = unknownKeys(input, new Set(['schemaVersion', 'rules']))
  if (topLevelExtras.length) errors.push(`规则集包含不允许的字段：${topLevelExtras.join(', ')}`)
  if (input.schemaVersion !== CUSTOM_RULE_SCHEMA_VERSION) errors.push(`schemaVersion 必须是 "${CUSTOM_RULE_SCHEMA_VERSION}"`)
  if (!Array.isArray(input.rules)) errors.push('rules 必须是数组')
  if (Array.isArray(input.rules) && input.rules.length > MAX_CUSTOM_RULES) errors.push(`rules 不能超过 ${MAX_CUSTOM_RULES} 条`)
  if (!Array.isArray(input.rules) || input.rules.length > MAX_CUSTOM_RULES) return { ok: false, errors }

  const ids = new Set<string>()
  const rules: CustomRule[] = []
  input.rules.forEach((candidate, index) => {
    const path = `rules[${index}]`
    if (!isPlainObject(candidate)) {
      errors.push(`${path} 必须是对象`)
      return
    }
    const extras = unknownKeys(candidate, RULE_KEYS)
    if (extras.length) errors.push(`${path} 包含不允许的字段：${extras.join(', ')}`)

    const idIsValid = typeof candidate.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate.id)
    if (!idIsValid) errors.push(`${path}.id 必须是 1-64 位字母、数字、点、下划线或连字符，并以字母或数字开头`)
    if (idIsValid && ids.has(candidate.id as string)) errors.push(`${path}.id 不能重复`)
    if (idIsValid) ids.add(candidate.id as string)
    if (typeof candidate.enabled !== 'boolean') errors.push(`${path}.enabled 必须是布尔值`)
    if (!SEVERITIES.has(candidate.severity as Severity)) errors.push(`${path}.severity 不是允许的风险级别`)
    if (!ISSUE_KINDS.has(candidate.kind as IssueKind)) errors.push(`${path}.kind 不是允许的问题类型`)
    if (!isSafeDisplayText(candidate.title, 120)) errors.push(`${path}.title 必须是 1-120 个无控制字符的文本`)
    if (!isSafeDisplayText(candidate.explanation, 600)) errors.push(`${path}.explanation 必须是 1-600 个无控制字符的文本`)
    const match = validateMatch(candidate.match, `${path}.match`, errors)

    if (
      extras.length
      || !idIsValid
      || typeof candidate.enabled !== 'boolean'
      || !SEVERITIES.has(candidate.severity as Severity)
      || !ISSUE_KINDS.has(candidate.kind as IssueKind)
      || !isSafeDisplayText(candidate.title, 120)
      || !isSafeDisplayText(candidate.explanation, 600)
      || !match
    ) return

    rules.push({
      id: candidate.id as string,
      enabled: candidate.enabled,
      match,
      severity: candidate.severity as Severity,
      kind: candidate.kind as IssueKind,
      title: candidate.title as string,
      explanation: candidate.explanation as string,
    })
  })

  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { schemaVersion: CUSTOM_RULE_SCHEMA_VERSION, rules }, errors: [] }
}

export function parseCustomRuleSet(json: string): CustomRuleSet {
  if (typeof json !== 'string') throw new CustomRuleValidationError(['规则输入必须是 JSON 文本'])
  if (json.length > MAX_RULE_JSON_LENGTH) throw new CustomRuleValidationError([`规则 JSON 不能超过 ${MAX_RULE_JSON_LENGTH} 个字符`])
  let input: unknown
  try {
    input = JSON.parse(json)
  } catch {
    throw new CustomRuleValidationError(['规则 JSON 无法解析'])
  }
  const result = validateCustomRuleSet(input)
  if (!result.ok) throw new CustomRuleValidationError(result.errors)
  return result.value
}

const textFieldValue = (record: MemoryRecord, field: CustomRuleTextField): string => {
  switch (field) {
    case 'title': return record.title
    case 'content': return record.content
    case 'tags': return record.tags.join('\n')
    case 'type': return record.type
    case 'scope': return record.scope
    case 'sensitivity': return record.sensitivity
    case 'source.uri': return record.source?.uri ?? ''
    case 'source.revision': return record.source?.revision ?? ''
    case 'source.locator': return record.source?.locator ?? ''
    case 'source.platform': return record.source?.platform ?? ''
  }
}

const ruleMatches = (record: MemoryRecord, match: CustomRuleMatch): boolean => {
  if (match.operator === 'date-before') {
    const recordValue = record[match.field]
    if (typeof recordValue !== 'string' || !isValidIsoDate(recordValue)) return false
    return Date.parse(recordValue) < Date.parse(match.value)
  }

  const input = textFieldValue(record, match.field)
  if (match.operator === 'contains') {
    return match.caseSensitive
      ? input.includes(match.value)
      : input.toLowerCase().includes(match.value.toLowerCase())
  }
  // validateCustomRuleSet has already excluded dangerous constructs and flags.
  return new RegExp(match.pattern, match.flags).test(input.slice(0, MAX_MATCH_INPUT_LENGTH))
}

const stableHash = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

const severityRank: Record<Severity, number> = { blocker: 0, high: 1, medium: 2, low: 3 }

/**
 * Runs validated rules against normalized records. Each issue references exactly
 * one original record ID; records without a usable ID cannot produce an issue.
 */
export function runCustomRules(
  records: readonly MemoryRecord[],
  ruleSetInput: CustomRuleSet,
  dispositions: Readonly<Record<string, Disposition>> = {},
): MemoryIssue[] {
  const validation = validateCustomRuleSet(ruleSetInput)
  if (!validation.ok) throw new CustomRuleValidationError(validation.errors)

  const issues: MemoryIssue[] = []
  const issueIds = new Set<string>()
  for (const rule of validation.value.rules) {
    if (!rule.enabled) continue
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id.trim() || !ruleMatches(record, rule.match)) continue
      const id = `custom-${rule.id}-${stableHash(record.id)}`
      if (issueIds.has(id)) continue
      issueIds.add(id)
      issues.push({
        id,
        kind: rule.kind,
        severity: rule.severity,
        title: rule.title,
        explanation: rule.explanation,
        sourceIds: [record.id],
        detection: 'rule',
        disposition: dispositions[id] ?? 'unreviewed',
      })
    }
  }

  return issues.sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || left.id.localeCompare(right.id))
}
