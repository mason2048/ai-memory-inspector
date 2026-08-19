import { describe, expect, it } from 'vitest'
import {
  IMPORT_FILE_ACCEPT,
  parseImportFile,
  SUPPORTED_IMPORT_EXTENSIONS,
  type LocalImportFile,
} from './stream-importer'

const file = (content: string, name: string) =>
  Object.assign(new Blob([content]), { name }) as LocalImportFile

describe('incremental large-file importer', () => {
  it('streams Markdown records and reports progress', async () => {
    const updates: number[] = []
    const records = await parseImportFile(
      file('- 第一条\n- 第二条\n\n第三段', 'large.md'),
      (value) => updates.push(value.percent),
    )
    expect(records).toHaveLength(3)
    expect(updates.at(-1)).toBe(100)
    expect(new Set(records.map((record) => record.id)).size).toBe(3)
  })

  it('streams Context Package object arrays without keeping a second parsed copy', async () => {
    const content = JSON.stringify({
      schemaVersion: '0.1',
      items: [
        {
          id: 'a',
          content: '住在上海',
          source: { uri: 'file:///a', revision: '1', locator: 'L1' },
        },
        {
          id: 'b',
          content: '喜欢简洁回答',
          source: { uri: 'file:///b', revision: '1', locator: 'L2' },
        },
      ],
    })
    const records = await parseImportFile(file(content, 'package.json'))
    expect(records.map((record) => record.id)).toEqual(['a', 'b'])
  })

  it('streams JSONL records', async () => {
    const records = await parseImportFile(
      file('{"id":"a","content":"一"}\n{"id":"b","content":"二"}\n', 'large.jsonl'),
    )
    expect(records).toHaveLength(2)
  })

  it('keeps the file picker accept list aligned with every parser extension', async () => {
    expect(IMPORT_FILE_ACCEPT.split(',')).toEqual([...SUPPORTED_IMPORT_EXTENSIONS])
    const fixtures: Record<(typeof SUPPORTED_IMPORT_EXTENSIONS)[number], string> = {
      '.md': '- Markdown 记忆',
      '.markdown': '- Markdown 长扩展名记忆',
      '.txt': 'TXT 记忆',
      '.json': '{"id":"json","content":"JSON 记忆"}',
      '.jsonl': '{"id":"jsonl","content":"JSONL 记忆"}',
      '.ndjson': '{"id":"ndjson","content":"NDJSON 记忆"}',
    }

    for (const extension of SUPPORTED_IMPORT_EXTENSIONS) {
      await expect(parseImportFile(file(fixtures[extension], `memory${extension}`))).resolves.not.toHaveLength(0)
    }
  })

  it('falls back safely for a single JSON object when no record array exists', async () => {
    const records = await parseImportFile(
      file('{"id":"single","content":"单条记录"}', 'single.json'),
    )
    expect(records.map((record) => record.id)).toEqual(['single'])
  })

  it('reports completed progress for an empty supported file', async () => {
    const updates: number[] = []
    const records = await parseImportFile(file('', 'empty.md'), (value) =>
      updates.push(value.percent),
    )
    expect(records).toEqual([])
    expect(updates).toEqual([100])
  })

  it('rejects unsupported file extensions before parsing content', async () => {
    await expect(parseImportFile(file('plain text', 'memory.csv'))).rejects.toThrow('仅支持')
  })

  it('supports cancellation without returning partial data', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      parseImportFile(file('- 一\n- 二', 'a.md'), undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
