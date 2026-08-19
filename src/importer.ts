import { redactText } from './redaction'
import { assertImportSize, assertJsonDepth, assertRecordCount, assertRecordSize } from './limits'
import { sanitizeSourceUri } from './uri'
import type { MemoryRecord, MemoryType, Scope, Sensitivity } from './types'

const stableId = (value: string) => {
  let hash = 14_695_981_039_346_656_037n
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n)
  }
  return `mem-${hash.toString(16).padStart(16, '0')}`
}

const inferType = (text: string): MemoryType => {
  if (/必须|禁止|不要|规则|should|must/i.test(text)) return 'instruction'
  if (/喜欢|偏好|习惯|prefer/i.test(text)) return 'preference'
  if (/项目|完成|进行中|上线|版本|状态/i.test(text)) return 'project-status'
  if (/电话|邮箱|地址|密钥|密码|身份证/i.test(text)) return 'sensitive'
  if (/家人|同事|朋友|关系/i.test(text)) return 'relationship'
  return 'fact'
}

const safeScope = (value: unknown): Scope => value === 'project' || value === 'task' ? value : 'global'
const safeSensitivity = (value: unknown): Sensitivity =>
  value === 'internal' || value === 'sensitive' || value === 'secret' ? value : 'public'

function normalizeItem(item: Record<string, unknown>, index: number, fileName: string): MemoryRecord {
  const rawContent = String(item.content ?? item.text ?? item.summary ?? item.title ?? '')
  assertRecordSize(rawContent)
  const redacted = redactText(rawContent)
  const metadataScan = redactText([
    item.id, item.title, item.tags,
    typeof item.source === 'object' && item.source !== null ? Object.values(item.source as Record<string, unknown>) : '',
  ].flat().map(String).join(' '))
  const safeString = (value: unknown, fallback = '') => redactText(String(value ?? fallback)).text
  const source = typeof item.source === 'object' && item.source !== null ? item.source as Record<string, unknown> : undefined
  const locator = safeString(source?.locator ?? item.locator, `记录 ${index + 1}`)
  const uriScan = sanitizeSourceUri(safeString(source?.uri, `file:///${encodeURIComponent(safeString(fileName))}`))
  const uri = uriScan.text
  const revision = safeString(source?.revision ?? item.revision, 'imported-local')
  const rank: Record<Sensitivity, number> = { public: 0, internal: 1, sensitive: 2, secret: 3 }
  const declaredSensitivity = safeSensitivity(item.sensitivity)
  const sensitivity = [declaredSensitivity, redacted.sensitivity, metadataScan.sensitivity, uriScan.sensitivity]
    .sort((a, b) => rank[b] - rank[a])[0]
  const secret = sensitivity === 'secret'
  const secretKinds = [...new Set([
    ...redacted.matches.map((match) => match.kind),
    ...metadataScan.matches.map((match) => match.kind),
    ...(declaredSensitivity === 'secret' ? ['来源标记为 secret'] : []),
  ])]
  return {
    id: secret ? stableId(`${uri}:${locator}:${String(item.id ?? '')}`) : safeString(item.id, stableId(`${uri}:${locator}:${redacted.text}`)),
    type: (['fact', 'preference', 'project-status', 'instruction', 'relationship', 'sensitive'] as const).includes(item.type as MemoryType)
      ? item.type as MemoryType
      : inferType(redacted.text),
    title: secret ? '[secret 记录已隐藏]' : safeString(item.title, redacted.text.slice(0, 36) || `记录 ${index + 1}`),
    content: secret ? (redacted.sensitivity === 'secret' ? redacted.text : '[secret 内容已隐藏]') : redacted.text,
    scope: safeScope(item.scope),
    source: secret
      ? { uri: 'secret://hidden', revision: 'hidden', locator: '敏感来源已隐藏', platform: '敏感来源' }
      : { uri, revision, locator, platform: safeString(source?.platform ?? item.platform, '本地文件') },
    observedAt: typeof item.observedAt === 'string' ? item.observedAt : typeof (item.validity as Record<string, unknown> | undefined)?.observedAt === 'string' ? String((item.validity as Record<string, unknown>).observedAt) : undefined,
    expiresAt: typeof item.expiresAt === 'string' ? item.expiresAt : typeof (item.validity as Record<string, unknown> | undefined)?.expiresAt === 'string' ? String((item.validity as Record<string, unknown>).expiresAt) : null,
    confidence: typeof item.confidence === 'number' ? item.confidence : typeof (item.validity as Record<string, unknown> | undefined)?.confidence === 'number' ? Number((item.validity as Record<string, unknown>).confidence) : 0.75,
    sensitivity,
    tags: secret
      ? secretKinds
      : [...new Set([
        ...(Array.isArray(item.tags) ? item.tags.map((tag) => safeString(tag)) : []),
        ...secretKinds,
      ])],
  }
}

function ensureUniqueRecordIds(records: MemoryRecord[]): MemoryRecord[] {
  const seen = new Map<string, number>()
  return records.map((record) => {
    const occurrence = (seen.get(record.id) ?? 0) + 1
    seen.set(record.id, occurrence)
    return occurrence === 1 ? record : { ...record, id: `${record.id}-${occurrence}` }
  })
}

function textRecords(text: string, fileName: string): MemoryRecord[] {
  const chunks = text
    .split(/\n(?=(?:[-*]\s+|#{1,6}\s+|\d+[.)]\s+))|\n{2,}/)
    .map((part) => part.replace(/^\s*(?:[-*]|#{1,6}|\d+[.)])\s*/, '').trim())
    .filter(Boolean)

  assertRecordCount(chunks.length)
  return ensureUniqueRecordIds(chunks.map((content, index) => normalizeItem({ content, locator: `片段 ${index + 1}` }, index, fileName)))
}

export function parseImport(text: string, fileName = 'pasted.txt'): MemoryRecord[] {
  assertImportSize(new TextEncoder().encode(text).byteLength)
  const trimmed = text.trim()
  if (!trimmed) return []

  if (fileName.toLowerCase().endsWith('.json') || /^[\[{]/.test(trimmed)) {
    assertJsonDepth(trimmed)
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const candidates = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).items)
          ? (parsed as Record<string, unknown>).items as unknown[]
          : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).memories)
            ? (parsed as Record<string, unknown>).memories as unknown[]
            : [parsed]
      assertRecordCount(candidates.length)
      return ensureUniqueRecordIds(candidates
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item, index) => normalizeItem(item, index, fileName))
        .filter((item) => item.content.length > 0))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      if (fileName.toLowerCase().endsWith('.json')) throw new Error('JSON 文件无法解析，请检查格式后重试。')
    }
  }

  return textRecords(trimmed, fileName)
}
