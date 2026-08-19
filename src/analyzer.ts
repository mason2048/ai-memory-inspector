import { redactText } from './redaction'
import type { MemoryIssue, MemoryRecord, Severity } from './types'

const severityRank: Record<Severity, number> = { blocker: 0, high: 1, medium: 2, low: 3 }
const MAX_ISSUES = 2_000
const MAX_NEAR_CANDIDATES_PER_RECORD = 128

const normalized = (value: string) => value.toLowerCase().replace(/[\s，。！？、,.!?;；:：'"“”‘’_-]/g, '')
const uniqueCharacters = (value: string) => [...new Set(normalized(value).split(''))]

const similarity = (a: string, b: string) => {
  const left = new Set(uniqueCharacters(a))
  const right = new Set(uniqueCharacters(b))
  if (!left.size || !right.size) return 0
  let overlap = 0
  left.forEach((char) => { if (right.has(char)) overlap += 1 })
  return overlap / (left.size + right.size - overlap)
}

const issueHash = (value: string) => {
  let hash = 14_695_981_039_346_656_037n
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n)
  }
  return hash.toString(16).padStart(16, '0')
}

const cities = ['北京', '上海', '杭州', '广州', '深圳', '成都', '南京', '苏州', '武汉', '西安']
const identityPatterns = [
  { topic: '姓名', pattern: /(?:名字|姓名|称呼)(?:是|为|：|:)?\s*([\p{Script=Han}A-Za-z·]{2,20})/u },
  { topic: '雇主', pattern: /(?:就职于|供职于|在)([\p{Script=Han}A-Za-z0-9&·（）()\s]{2,30})(?:工作|任职)/u },
  { topic: '职位', pattern: /(?:职位|岗位|职务)(?:是|为|：|:)?\s*([^，。\n]{2,24})/u },
  { topic: '语言偏好', pattern: /(?:使用|偏好|回答用)(中文|英文|日文|简体中文|繁体中文)/u },
]

const polarity = (text: string) => /(?:不再|不是|不要|已离职|已停用|禁止)/.test(text) ? 'negative' : 'positive'
const mostRecent = (records: MemoryRecord[]) => [...records].sort((left, right) =>
  (Date.parse(right.observedAt ?? '') || 0) - (Date.parse(left.observedAt ?? '') || 0))[0]

const emitDuplicateGroup = (records: MemoryRecord[], add: (issue: Omit<MemoryIssue, 'id' | 'disposition'>) => void) => {
  const anchor = records[0]
  for (let offset = 1; offset < records.length; offset += 19) {
    add({
      kind: 'duplicate',
      severity: 'low',
      title: '发现完全重复的记忆',
      explanation: '这些记录规范化后的内容完全相同，可以考虑只保留来源更清晰的一条。',
      sourceIds: [anchor.id, ...records.slice(offset, offset + 19).map((record) => record.id)],
      detection: 'rule',
    })
  }
}

export function analyzeMemories(records: MemoryRecord[], dispositions: Record<string, MemoryIssue['disposition']> = {}, now = new Date()): MemoryIssue[] {
  const issues: MemoryIssue[] = []
  const seenIssueIds = new Set<string>()
  const add = (issue: Omit<MemoryIssue, 'id' | 'disposition'>) => {
    if (issues.length >= MAX_ISSUES) return
    const sourceIds = [...new Set(issue.sourceIds)]
    if (!sourceIds.length) return
    const id = `issue-${issue.kind}-${issueHash([...sourceIds].sort().join('\0'))}`
    if (seenIssueIds.has(id)) return
    seenIssueIds.add(id)
    issues.push({ ...issue, sourceIds, id, disposition: dispositions[id] ?? 'unreviewed' })
  }

  records.forEach((record) => {
    const scan = redactText(record.content)
    const secretTag = record.tags.find((tag) => ['API Key', 'JWT / Bearer Token', '连接串凭据', '通用密钥', '密码', '私钥', '身份证件', '来源标记为 secret'].includes(tag))
    const highTag = record.tags.find((tag) => ['邮箱', '电话', '精确地址'].includes(tag))
    if (record.sensitivity === 'secret' || secretTag || scan.sensitivity === 'secret') {
      add({ kind: 'sensitive', severity: 'blocker', title: `检测到${secretTag ?? scan.matches[0]?.kind ?? '高敏感内容'}`, explanation: '规则匹配到秘密或阻断级个人信息。内容已在进入本地存储前脱敏。', sourceIds: [record.id], detection: 'rule' })
    } else if (record.sensitivity === 'sensitive' || highTag || scan.sensitivity === 'sensitive') {
      add({ kind: 'sensitive', severity: 'high', title: `检测到${highTag ?? scan.matches[0]?.kind ?? '敏感个人信息'}`, explanation: '规则匹配到邮箱、电话或精确地址等敏感个人信息。', sourceIds: [record.id], detection: 'rule' })
    }
    if (!record.source?.uri || !record.source.locator || !record.source.revision) {
      add({ kind: 'unsourced', severity: 'medium', title: '记录缺少可追溯来源', explanation: '无法同时确认来源位置和内容版本，建议补充来源后再迁移。', sourceIds: [record.id], detection: 'rule' })
    }
    const expiresAt = record.expiresAt ? new Date(record.expiresAt) : null
    const observedAt = record.observedAt ? new Date(record.observedAt) : null
    const statusTooOld = record.type === 'project-status' && observedAt && now.getTime() - observedAt.getTime() > 180 * 86_400_000
    if ((expiresAt && expiresAt < now) || statusTooOld) {
      add({ kind: 'stale', severity: 'medium', title: '项目状态可能已经过期', explanation: expiresAt ? '记录的有效期已经结束。' : '项目状态超过 180 天未更新，需要回到来源核实。', sourceIds: [record.id], detection: 'rule' })
    }
  })

  const comparable = records.filter((record) => record.sensitivity !== 'secret')
  const exactGroups = new Map<string, MemoryRecord[]>()
  comparable.forEach((record) => {
    const key = normalized(record.content)
    if (!key) return
    const group = exactGroups.get(key) ?? []
    group.push(record)
    exactGroups.set(key, group)
  })
  exactGroups.forEach((group) => { if (group.length > 1) emitDuplicateGroup(group, add) })

  const features = comparable.map((record) => uniqueCharacters(record.content))
  const inverted = new Map<string, number[]>()
  comparable.forEach((record, index) => {
    for (const character of features[index]) {
      const key = `${record.type}\0${character}`
      const bucket = inverted.get(key) ?? []
      bucket.push(index)
      inverted.set(key, bucket)
    }
  })
  const comparedPairs = new Set<string>()
  comparable.forEach((record, index) => {
    if (issues.length >= MAX_ISSUES) return
    const candidateIds = new Set<number>()
    const rarest = features[index]
      .map((character) => inverted.get(`${record.type}\0${character}`) ?? [])
      .sort((left, right) => left.length - right.length)
      .slice(0, 3)
    for (const bucket of rarest) {
      for (const candidate of bucket) {
        if (candidate <= index) continue
        candidateIds.add(candidate)
        if (candidateIds.size >= MAX_NEAR_CANDIDATES_PER_RECORD) break
      }
      if (candidateIds.size >= MAX_NEAR_CANDIDATES_PER_RECORD) break
    }
    for (const candidate of candidateIds) {
      const other = comparable[candidate]
      const pairKey = `${index}:${candidate}`
      if (comparedPairs.has(pairKey)) continue
      comparedPairs.add(pairKey)
      const left = normalized(record.content)
      const right = normalized(other.content)
      if (!left || left === right) continue
      const sizeRatio = Math.min(features[index].length, features[candidate].length) / Math.max(features[index].length, features[candidate].length, 1)
      if (sizeRatio >= 0.75 && similarity(record.content, other.content) >= 0.82) {
        add({ kind: 'duplicate', severity: 'low', title: '发现近似重复的记忆', explanation: '两条同类记录措辞高度相似，需要人工确认是否合并。', sourceIds: [record.id, other.id], detection: 'inference' })
      }
    }
  })

  const residence = new Map<string, MemoryRecord[]>()
  comparable.forEach((record) => {
    if (!/住在|居住|搬到|常住/.test(record.content)) return
    const city = cities.find((candidate) => record.content.includes(candidate))
    if (!city) return
    const group = residence.get(city) ?? []
    group.push(record)
    residence.set(city, group)
  })
  const residenceGroups = [...residence.entries()]
  for (let left = 0; left < residenceGroups.length; left += 1) {
    for (let right = left + 1; right < residenceGroups.length; right += 1) {
      const [leftCity, leftRecords] = residenceGroups[left]
      const [rightCity, rightRecords] = residenceGroups[right]
      add({ kind: 'conflict', severity: 'medium', title: `居住城市存在时间相关冲突：${leftCity} / ${rightCity}`, explanation: '这些记录描述了不同的居住城市。较新的记录可能是状态更新，但工具不会擅自判定真伪或删除旧项。', sourceIds: [mostRecent(leftRecords).id, mostRecent(rightRecords).id], detection: 'rule' })
    }
  }

  for (const identity of identityPatterns) {
    const values = new Map<string, { display: string; records: MemoryRecord[] }>()
    comparable.forEach((record) => {
      const display = record.content.match(identity.pattern)?.[1]?.trim()
      if (!display) return
      const key = normalized(display)
      const value = values.get(key) ?? { display, records: [] }
      value.records.push(record)
      values.set(key, value)
    })
    if (values.size > 1) {
      const groups = [...values.values()].slice(0, 20)
      const labels = groups.slice(0, 4).map((group) => group.display)
      add({ kind: 'conflict', severity: 'medium', title: `${identity.topic}存在冲突：${labels.join(' / ')}${values.size > labels.length ? ' / …' : ''}`, explanation: `多条记录对同一${identity.topic}给出了不同内容，需要结合观察时间和来源人工确认。`, sourceIds: groups.map((group) => mostRecent(group.records).id), detection: 'rule' })
    }
  }

  const titles = new Map<string, { display: string; positive: MemoryRecord[]; negative: MemoryRecord[] }>()
  comparable.forEach((record) => {
    const key = normalized(record.title)
    if (!key) return
    const group = titles.get(key) ?? { display: record.title, positive: [], negative: [] }
    group[polarity(record.content)].push(record)
    titles.set(key, group)
  })
  titles.forEach((group) => {
    if (!group.positive.length || !group.negative.length) return
    add({ kind: 'conflict', severity: 'medium', title: `${group.display}存在肯定/否定冲突`, explanation: '同一主题的一条记录为肯定描述，另一条为否定或已失效描述，需要人工核实时间顺序。', sourceIds: [mostRecent(group.positive).id, mostRecent(group.negative).id], detection: 'rule' })
  })

  return issues.sort((left, right) => severityRank[left.severity] - severityRank[right.severity])
}
