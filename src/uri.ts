import { redactText } from './redaction'
import type { Sensitivity } from './types'

export interface SanitizedUri {
  text: string
  sensitivity: Sensitivity
}

export function sanitizeSourceUri(input: string): SanitizedUri {
  const redacted = redactText(input)
  if (redacted.sensitivity === 'secret') return { text: 'secret://hidden', sensitivity: 'secret' }
  try {
    const url = new URL(redacted.text)
    const hadCredentials = Boolean(url.username || url.password)
    url.username = ''
    url.password = ''
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.search = ''
      url.hash = ''
    }
    return {
      text: url.toString(),
      sensitivity: hadCredentials ? 'secret' : redacted.sensitivity,
    }
  } catch {
    return redacted
  }
}
