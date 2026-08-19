import { describe, expect, it } from 'vitest'
import { parseImport } from './importer'
import { IMPORT_LIMITS } from './limits'
import { parseImportFile, type LocalImportFile } from './stream-importer'

describe('production import limits', () => {
  it('rejects a single oversized record', () => {
    const content = 'x'.repeat(IMPORT_LIMITS.maxRecordBytes + 1)
    expect(() => parseImport(JSON.stringify([{ content }]), 'large-record.json')).toThrow('单条记录超过')
  })

  it('rejects JSON deeper than the supported schema budget', () => {
    const nested = `${'['.repeat(IMPORT_LIMITS.maxJsonDepth + 1)}0${']'.repeat(IMPORT_LIMITS.maxJsonDepth + 1)}`
    expect(() => parseImport(nested, 'deep.json')).toThrow('JSON 嵌套超过')
  })

  it('rejects an oversized file before opening its stream', async () => {
    const oversized = {
      name: 'too-large.json',
      size: IMPORT_LIMITS.maxBytes + 1,
      stream: () => { throw new Error('stream must not be opened') },
    } as unknown as LocalImportFile
    await expect(parseImportFile(oversized)).rejects.toThrow('文件超过 25 MB')
  })
})
