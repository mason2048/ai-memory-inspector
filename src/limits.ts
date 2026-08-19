export const IMPORT_LIMITS = Object.freeze({
  maxBytes: 25 * 1024 * 1024,
  maxRecords: 5_000,
  maxRecordBytes: 256 * 1024,
  maxJsonDepth: 32,
})

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function assertImportSize(bytes: number): void {
  if (bytes > IMPORT_LIMITS.maxBytes) {
    throw new Error(`文件超过 ${formatBytes(IMPORT_LIMITS.maxBytes)} 的首版安全上限，请拆分后再导入。`)
  }
}

export function assertRecordCount(count: number): void {
  if (count > IMPORT_LIMITS.maxRecords) {
    throw new Error(`记录数超过 ${IMPORT_LIMITS.maxRecords.toLocaleString('zh-CN')} 条的首版安全上限，请拆分后再导入。`)
  }
}

export function assertRecordSize(value: string): void {
  const bytes = new TextEncoder().encode(value).byteLength
  if (bytes > IMPORT_LIMITS.maxRecordBytes) {
    throw new Error(`单条记录超过 ${formatBytes(IMPORT_LIMITS.maxRecordBytes)} 的安全上限。`)
  }
}

export function assertJsonDepth(value: string): void {
  let depth = 0
  let inString = false
  let escaped = false

  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{' || character === '[') {
      depth += 1
      if (depth > IMPORT_LIMITS.maxJsonDepth) {
        throw new Error(`JSON 嵌套超过 ${IMPORT_LIMITS.maxJsonDepth} 层的安全上限。`)
      }
    } else if (character === '}' || character === ']') depth = Math.max(0, depth - 1)
  }
}
