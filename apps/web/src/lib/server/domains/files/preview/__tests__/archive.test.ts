import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { deriveArchivePreview } from '../archive'

describe('deriveArchivePreview', () => {
  it('counts the entries in a zip', async () => {
    const zip = zipSync({
      'a.txt': strToU8('a'),
      'logs/b.log': strToU8('b'),
      'c.png': strToU8('c'),
    })
    expect(await deriveArchivePreview(zip)).toEqual({ status: 'ready', meta: { entries: 3 } })
  })

  it('counts past the budget an office package is held to, without inflating', async () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 2500; i++) files[`f${i}`] = new Uint8Array(0)
    expect((await deriveArchivePreview(zipSync(files))).meta).toEqual({ entries: 2500 })
  })

  it('refuses bytes that are not a zip', async () => {
    await expect(deriveArchivePreview(strToU8('PK\u0003\u0004 nope'))).rejects.toThrow()
  })
})
