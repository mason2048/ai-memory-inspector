import { parseImport } from './importer'
import { assertImportSize, assertRecordCount } from './limits'
import type { MemoryRecord } from './types'

export interface ImportProgress {
  bytesRead: number
  totalBytes: number
  recordsParsed: number
  percent: number
}

export type LocalImportFile = Blob & { name: string }

export const SUPPORTED_IMPORT_EXTENSIONS = [
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.jsonl',
  '.ndjson',
] as const

export const IMPORT_FILE_ACCEPT = SUPPORTED_IMPORT_EXTENSIONS.join(',')

export const IMPORT_FORMAT_LABELS = [
  'Markdown (.md / .markdown)',
  'TXT (.txt)',
  'JSON (.json)',
  'JSONL (.jsonl)',
  'NDJSON (.ndjson)',
  'Context Package v0.1 (.json)',
] as const

const progress = (bytesRead: number, totalBytes: number, recordsParsed: number): ImportProgress => ({
  bytesRead,
  totalBytes,
  recordsParsed,
  percent: totalBytes ? Math.min(100, Math.round((bytesRead / totalBytes) * 100)) : 100,
})

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('导入已取消。', 'AbortError')
}

function appendRecords(target: MemoryRecord[], next: MemoryRecord[]): void {
  assertRecordCount(target.length + next.length)
  target.push(...next)
}

async function parseTextStream(file: LocalImportFile, onProgress?: (value: ImportProgress) => void, signal?: AbortSignal): Promise<MemoryRecord[]> {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  const records: MemoryRecord[] = []
  let buffer = ''
  let paragraph = ''
  let bytesRead = 0

  const flush = () => {
    const content = paragraph.trim()
    paragraph = ''
    if (!content) return
    const parsed = parseImport(content, file.name)
    for (const record of parsed) {
      const index = records.length + 1
      appendRecords(records, [{
        ...record,
        id: `${record.id}-${index}`,
        source: record.source ? { ...record.source, locator: `片段 ${index}` } : record.source,
      }])
    }
  }

  while (true) {
    assertActive(signal)
    const { value, done } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const startsRecord = /^\s*(?:[-*]\s+|#{1,6}\s+|\d+[.)]\s+)/.test(line)
      if (!line.trim()) flush()
      else if (startsRecord) {
        flush()
        paragraph = line
        flush()
      } else paragraph += `${paragraph ? '\n' : ''}${line}`
    }
    onProgress?.(progress(bytesRead, file.size, records.length))
  }
  buffer += decoder.decode()
  paragraph += `${paragraph && buffer ? '\n' : ''}${buffer}`
  flush()
  onProgress?.(progress(file.size, file.size, records.length))
  return records
}

class JsonObjectArrayScanner {
  private waiting = ''
  private started = false
  private inString = false
  private escaped = false
  private depth = 0
  private current = ''
  private objects: string[] = []

  push(chunk: string): string[] {
    this.objects = []
    for (const char of chunk) this.consume(char)
    return this.objects
  }

  private consume(char: string) {
    if (!this.started) {
      this.waiting = `${this.waiting}${char}`.slice(-160)
      const trimmed = this.waiting.trimStart()
      if (trimmed.startsWith('[') || /"(?:items|memories)"\s*:\s*\[$/.test(this.waiting)) this.started = true
      return
    }

    if (this.depth === 0) {
      if (char === '{') {
        this.depth = 1
        this.current = '{'
      }
      return
    }

    this.current += char
    if (this.inString) {
      if (this.escaped) this.escaped = false
      else if (char === '\\') this.escaped = true
      else if (char === '"') this.inString = false
      return
    }
    if (char === '"') this.inString = true
    else if (char === '{') this.depth += 1
    else if (char === '}') {
      this.depth -= 1
      if (this.depth === 0) {
        this.objects.push(this.current)
        this.current = ''
      }
    }
  }

  get foundArray() { return this.started }
}

async function parseJsonStream(file: LocalImportFile, onProgress?: (value: ImportProgress) => void, signal?: AbortSignal): Promise<MemoryRecord[]> {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  const scanner = new JsonObjectArrayScanner()
  const records: MemoryRecord[] = []
  let bytesRead = 0
  let fallback = ''
  const fallbackLimit = 10 * 1024 * 1024

  while (true) {
    assertActive(signal)
    const { value, done } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    const text = decoder.decode(value, { stream: true })
    if (fallback.length <= fallbackLimit) fallback += text
    for (const objectText of scanner.push(text)) {
      const parsed = parseImport(`[${objectText}]`, file.name)
      appendRecords(records, parsed)
    }
    onProgress?.(progress(bytesRead, file.size, records.length))
  }
  const tail = decoder.decode()
  if (tail) {
    fallback += tail
    for (const objectText of scanner.push(tail)) appendRecords(records, parseImport(`[${objectText}]`, file.name))
  }

  if (!scanner.foundArray) {
    if (file.size > fallbackLimit) throw new Error('超大 JSON 需使用顶层数组、items/memories 数组或 JSONL 格式，才能增量处理。')
    return parseImport(fallback, file.name)
  }
  onProgress?.(progress(file.size, file.size, records.length))
  return records
}

async function parseJsonLinesStream(file: LocalImportFile, onProgress?: (value: ImportProgress) => void, signal?: AbortSignal): Promise<MemoryRecord[]> {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  const records: MemoryRecord[] = []
  let buffer = ''
  let bytesRead = 0
  while (true) {
    assertActive(signal)
    const { value, done } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) appendRecords(records, parseImport(`[${line}]`, file.name))
    onProgress?.(progress(bytesRead, file.size, records.length))
  }
  buffer += decoder.decode()
  if (buffer.trim()) appendRecords(records, parseImport(`[${buffer}]`, file.name))
  onProgress?.(progress(file.size, file.size, records.length))
  return records
}

export async function parseImportFile(file: LocalImportFile, onProgress?: (value: ImportProgress) => void, signal?: AbortSignal): Promise<MemoryRecord[]> {
  assertImportSize(file.size)
  assertActive(signal)
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jsonl' || extension === 'ndjson') return parseJsonLinesStream(file, onProgress, signal)
  if (extension === 'json') return parseJsonStream(file, onProgress, signal)
  if (extension === 'md' || extension === 'markdown' || extension === 'txt') return parseTextStream(file, onProgress, signal)
  throw new Error('仅支持 Markdown、TXT、JSON、JSONL、NDJSON 或 Context Package v0.1（JSON）。')
}
