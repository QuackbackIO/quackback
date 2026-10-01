import { describe, expect, it, vi } from 'vitest'
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { readZipIndex } from '@/lib/shared/files/zip-budget'
import {
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  rebuildZipPackage,
  withTimeout,
  BudgetTimeoutError,
} from '../budgets'
import { declareSize, deferSizes, renameInIndex } from './zip-fixtures'

const MB = 1024 * 1024

function zipOf(files: Zippable): Uint8Array {
  return zipSync(files, { level: 1 })
}

/** Rewrites every central directory entry's declared uncompressed size. */
function withDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice()
  const view = new DataView(out.buffer)
  for (let i = 0; i + 46 <= out.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true)
  }
  return out
}

function rebuilt(result: ReturnType<typeof rebuildZipPackage>): Uint8Array {
  if (!result.ok) throw new Error(`expected a package, got ${result.failure}`)
  return result.bytes
}

describe('rebuildZipPackage: the index budget', () => {
  it('refuses a zip that claims millions of entries without walking them', () => {
    const b = new Uint8Array(188)
    const v = new DataView(b.buffer)
    const z64 = 60
    v.setUint32(z64, 0x06064b50, true)
    v.setUint32(z64 + 24, 5_000_000, true)
    v.setUint32(z64 + 32, 5_000_000, true)
    const eocd = 188 - 22
    v.setUint32(eocd - 20, 0x07064b50, true)
    v.setUint32(eocd - 12, z64, true)
    v.setUint32(eocd, 0x06054b50, true)
    v.setUint16(eocd + 8, 0xffff, true)
    v.setUint16(eocd + 10, 0xffff, true)
    v.setUint32(eocd + 16, 0xffffffff, true)
    b.set([0x50, 0x4b, 0x03, 0x04])
    const started = performance.now()
    expect(rebuildZipPackage(b)).toEqual({ ok: false, failure: 'too_large' })
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('refuses more entries than the budget allows', () => {
    const files: Zippable = {}
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`f/${i}.xml`] = strToU8('x')
    expect(rebuildZipPackage(zipOf(files))).toEqual({ ok: false, failure: 'too_large' })
  })

  it('passes exactly the entry budget', () => {
    const files: Zippable = {}
    for (let i = 0; i < MAX_ZIP_ENTRIES; i++) files[`f/${i}.xml`] = strToU8('x')
    expect(rebuildZipPackage(zipOf(files))).toMatchObject({ ok: true, entries: MAX_ZIP_ENTRIES })
  })

  it('refuses a package that unpacks past the size budget, without inflating it', () => {
    // Sixteen 10 MB entries of zeros: about 160 MB declared, a few hundred KB packed.
    const chunk = new Uint8Array(10 * MB)
    const files: Zippable = {}
    for (let i = 0; i < 16; i++) files[`xl/worksheets/sheet${i}.xml`] = chunk
    const zip = zipOf(files)
    expect(zip.length).toBeLessThan(MB)
    expect(16 * chunk.length).toBeGreaterThan(MAX_ZIP_UNCOMPRESSED_BYTES)
    const started = performance.now()
    expect(rebuildZipPackage(zip)).toEqual({ ok: false, failure: 'too_large' })
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('honours a smaller budget passed by the caller', () => {
    const zip = zipOf({ 'a.xml': new Uint8Array(4096) })
    expect(rebuildZipPackage(zip, { maxUncompressedBytes: 4095 })).toEqual({
      ok: false,
      failure: 'too_large',
    })
    expect(rebuildZipPackage(zip, { maxUncompressedBytes: 4096 })).toMatchObject({ ok: true })
  })

  it('refuses an entry claiming a ratio no deflate stream can reach', () => {
    const zip = zipOf({ 'word/document.xml': strToU8('<w:document>tiny</w:document>') })
    const lying = withDeclaredSize(zip, 50 * MB)
    expect(rebuildZipPackage(lying)).toEqual({ ok: false, failure: 'too_large' })
  })

  it('reports bytes that are not a zip as corrupt', () => {
    expect(rebuildZipPackage(strToU8('just some text, not a package'))).toEqual({
      ok: false,
      failure: 'corrupt',
    })
    expect(rebuildZipPackage(new Uint8Array(0))).toEqual({ ok: false, failure: 'corrupt' })
  })
})

describe('rebuildZipPackage: the rebuilt package', () => {
  it('holds every entry with the same bytes, stored so no library inflates anything', () => {
    const zip = zipOf({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document>hello</w:document>'),
      'word/media/': new Uint8Array(0),
    })
    const result = rebuildZipPackage(zip)
    expect(result).toMatchObject({ ok: true, uncompressedBytes: 38 })
    const bytes = rebuilt(result)
    const out = unzipSync(bytes)
    expect(Object.keys(out).sort()).toEqual(['[Content_Types].xml', 'word/document.xml'])
    expect(new TextDecoder().decode(out['word/document.xml'])).toBe(
      '<w:document>hello</w:document>'
    )
    for (const entry of readZipIndex(bytes)) {
      expect(entry.compression).toBe(0)
      expect(entry.compressedSize).toBe(entry.originalSize)
    }
  })

  it('stops an entry at its declared size instead of inflating what it really holds', () => {
    // 64 MB of zeros packs into about 64 KB; the headers claim 1 KB.
    const zip = zipOf({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/worksheets/sheet1.xml': new Uint8Array(64 * MB),
    })
    const bomb = declareSize(zip, 'xl/worksheets/sheet1.xml', 1024)
    expect(bomb.length).toBeLessThan(MB)
    expect(rebuildZipPackage(bomb)).toEqual({ ok: false, failure: 'corrupt' })
    // Refused at the step that crosses 1 KB, long before the rest inflates.
    // The fastest of a few runs keeps a stray pause from deciding the result.
    const fastest = (work: () => void, runs: number) =>
      Math.min(
        ...Array.from({ length: runs }, () => {
          const started = performance.now()
          work()
          return performance.now() - started
        })
      )
    const refusing = fastest(() => rebuildZipPackage(bomb), 3)
    const inflatingAll = fastest(() => unzipSync(zip), 2)
    expect(refusing).toBeLessThan(inflatingAll / 2)
  })

  it('refuses a package whose local header disagrees with its index', () => {
    const zip = zipOf({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document>hello</w:document>'),
    })
    expect(rebuildZipPackage(declareSize(zip, 'word/document.xml', 5000, 'local'))).toEqual({
      ok: false,
      failure: 'corrupt',
    })
    expect(rebuildZipPackage(declareSize(zip, 'word/document.xml', 5, 'central'))).toEqual({
      ok: false,
      failure: 'corrupt',
    })
  })

  it('accepts sizes deferred to a data descriptor, as streaming writers leave them', () => {
    const zip = zipOf({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document>hello</w:document>'),
    })
    const out = unzipSync(rebuilt(rebuildZipPackage(deferSizes(zip, 'word/document.xml'))))
    expect(new TextDecoder().decode(out['word/document.xml'])).toBe(
      '<w:document>hello</w:document>'
    )
  })

  it('refuses an index that names the same part twice', () => {
    const zip = zipOf({
      'word/document.xml': strToU8('<w:document>real</w:document>'),
      'word/documenx.xml': strToU8('<w:document>shadow</w:document>'),
    })
    const twice = renameInIndex(zip, 'word/documenx.xml', 'word/document.xml')
    expect(rebuildZipPackage(twice)).toEqual({ ok: false, failure: 'corrupt' })
  })
})

describe('withTimeout', () => {
  it('resolves with the work when it finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
  })

  it('rejects with a timeout error when the work outlives the budget', async () => {
    vi.useFakeTimers()
    try {
      const never = new Promise<number>(() => {})
      const pending = withTimeout(never, 15_000)
      const settled = expect(pending).rejects.toBeInstanceOf(BudgetTimeoutError)
      await vi.advanceTimersByTimeAsync(15_000)
      await settled
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes the work’s own failure through', async () => {
    const boom = new Error('bad file')
    await expect(withTimeout(Promise.reject(boom), 1000)).rejects.toBe(boom)
  })
})
