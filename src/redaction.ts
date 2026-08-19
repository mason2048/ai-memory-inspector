import type { Sensitivity } from './types'

export interface RedactionResult {
  text: string
  sensitivity: Sensitivity
  matches: Array<{ kind: string; severity: 'blocker' | 'high' }>
}

type Rule = {
  kind: string
  severity: 'blocker' | 'high'
  sensitivity: Sensitivity
  pattern: RegExp
  replace: (value: string) => string
}

const mask = (value: string, start = 2, end = 2) => {
  if (value.length <= start + end) return '••••'
  return `${value.slice(0, start)}${'•'.repeat(Math.min(14, value.length - start - end))}${value.slice(-end)}`
}

const rules: Rule[] = [
  {
    kind: '私钥', severity: 'blocker', sensitivity: 'secret',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
    replace: () => '[私钥已脱敏]',
  },
  {
    kind: 'API Key', severity: 'blocker', sensitivity: 'secret',
    pattern: /\b(?:sk-(?:test[_-]?)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g,
    replace: (value) => mask(value, value.startsWith('sk-') || value.startsWith('sk_') ? 3 : 4, 3),
  },
  {
    kind: 'JWT / Bearer Token', severity: 'blocker', sensitivity: 'secret',
    pattern: /(?:Bearer\s+)?eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gi,
    replace: () => '[访问令牌已脱敏]',
  },
  {
    kind: '连接串凭据', severity: 'blocker', sensitivity: 'secret',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s]+/gi,
    replace: (value) => `${value.slice(0, value.indexOf('://') + 3)}[凭据已脱敏]@${value.slice(value.lastIndexOf('@') + 1).split(/[?#]/)[0]}`,
  },
  {
    kind: '密码', severity: 'blocker', sensitivity: 'secret',
    pattern: /(password|passwd|pwd|密码)\s*[:=：]\s*([^\s,，;；]{4,})/gi,
    replace: (value) => `${value.split(/[:=：]/)[0]}: [已脱敏]`,
  },
  {
    kind: '通用密钥', severity: 'blocker', sensitivity: 'secret',
    pattern: /\b(api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token)\s*[:=：]\s*([A-Za-z0-9_./+\-=]{12,})/gi,
    replace: (value) => `${value.split(/[:=：]/)[0]}: [已脱敏]`,
  },
  {
    kind: '身份证件', severity: 'blocker', sensitivity: 'secret',
    pattern: /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    replace: (value) => mask(value, 3, 2),
  },
  {
    kind: '邮箱', severity: 'high', sensitivity: 'sensitive',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replace: (value) => {
      const [name, domain] = value.split('@')
      return `${name.slice(0, 1)}•••@${domain}`
    },
  },
  {
    kind: '电话', severity: 'high', sensitivity: 'sensitive',
    pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/g,
    replace: (value) => mask(value.replace(/[\s-]/g, ''), 3, 2),
  },
  {
    kind: '精确地址', severity: 'high', sensitivity: 'sensitive',
    pattern: /(?:住址|地址|家住)\s*[:：]?\s*[^\n，。]{4,40}(?:路|街|巷|弄|号|室)/g,
    replace: (value) => `${value.slice(0, value.search(/[:：]/) + 1 || 2)} [精确地址已脱敏]`,
  },
]

const rank: Record<Sensitivity, number> = { public: 0, internal: 1, sensitive: 2, secret: 3 }

export function redactText(input: string): RedactionResult {
  let text = input
    .normalize('NFC')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  let sensitivity: Sensitivity = 'public'
  const matches: RedactionResult['matches'] = []

  for (const rule of rules) {
    let hit = false
    text = text.replace(rule.pattern, (value) => {
      hit = true
      return rule.replace(value)
    })
    if (hit) {
      matches.push({ kind: rule.kind, severity: rule.severity })
      if (rank[rule.sensitivity] > rank[sensitivity]) sensitivity = rule.sensitivity
    }
  }

  return { text, sensitivity, matches }
}

export function containsPlainSecret(input: string): boolean {
  return rules.filter((rule) => rule.sensitivity === 'secret').some((rule) => {
    rule.pattern.lastIndex = 0
    return rule.pattern.test(input)
  })
}
