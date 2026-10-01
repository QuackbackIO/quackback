import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  readZipIndex,
  checkZipBudget,
  openZip,
  inflateZipEntry,
  verifyZipSizes,
  ZipBudgetError,
  ZipFormatError,
} from '../zip-budget'

const MB = 1024 * 1024

function u32(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16)) +
    buf[offset + 3]! * 0x1000000
  )
}

function setU32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
  buf[offset + 2] = (value >>> 16) & 0xff
  buf[offset + 3] = (value >>> 24) & 0xff
}

/** Offsets of every central directory header in a zip fflate wrote. */
function centralHeaders(zip: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i + 4 <= zip.length; i++) if (u32(zip, i) === 0x02014b50) out.push(i)
  return out
}

/** Rewrite one entry's declared uncompressed size in both of its headers. */
function claimOriginalSize(zip: Uint8Array, entryIndex: number, size: number): Uint8Array {
  const out = zip.slice()
  const central = centralHeaders(out)[entryIndex]!
  setU32(out, central + 24, size)
  const local = u32(out, central + 42)
  setU32(out, local + 22, size)
  return out
}

/** Overwrite an entry's compressed data with bytes that are not a deflate stream. */
function garbleData(zip: Uint8Array, entryIndex: number): Uint8Array {
  const out = zip.slice()
  const central = centralHeaders(out)[entryIndex]!
  const local = u32(out, central + 42)
  const start = local + 30 + (out[local + 26]! | (out[local + 27]! << 8)) + out[local + 28]!
  const size = u32(out, central + 20)
  // BFINAL=1, BTYPE=11 (reserved): an inflater rejects this on the first byte.
  out.fill(0xff, start, start + size)
  return out
}

describe('readZipIndex', () => {
  it('lists every entry with sizes and compression, inflating nothing', () => {
    const zip = zipSync({
      'a.txt': strToU8('hello hello hello hello'),
      'dir/b.bin': [new Uint8Array([1, 2, 3]), { level: 0 }],
    })
    const entries = readZipIndex(zip)
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.bin'])
    expect(entries[0]).toMatchObject({ compression: 8, originalSize: 23 })
    expect(entries[1]).toMatchObject({ compression: 0, originalSize: 3, compressedSize: 3 })
  })

  it('refuses bytes that are not a zip', () => {
    expect(() => readZipIndex(strToU8('not a zip at all'))).toThrow(ZipFormatError)
  })

  it('refuses an index with more entries than the cap before reading them', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 30; i++) files[`f${i}.txt`] = strToU8('x')
    expect(() => readZipIndex(zipSync(files), { maxEntries: 20 })).toThrow(ZipBudgetError)
    expect(readZipIndex(zipSync(files), { maxEntries: 30 })).toHaveLength(30)
  })
})

describe('checkZipBudget', () => {
  it('refuses a claimed total over the budget before inflating anything', () => {
    const zip = zipSync({ 'word/document.xml': strToU8('<w:document/>'.repeat(10)) })
    // The data is no longer a deflate stream: only an index check can answer
    // without an inflate error.
    const bomb = garbleData(claimOriginalSize(zip, 0, 200 * MB), 0)
    const entries = readZipIndex(bomb)
    expect(() => checkZipBudget(entries)).toThrow(ZipBudgetError)
    expect(() => openZip(bomb)).toThrow(ZipBudgetError)
  })

  it('refuses a highly compressible entry by its ratio', () => {
    const zip = zipSync({ 'xl/worksheets/sheet1.xml': new Uint8Array(8 * MB) })
    const entries = readZipIndex(zip)
    expect(entries[0]!.compressedSize).toBeLessThan(MB / 64)
    expect(() => checkZipBudget(entries)).toThrow(ZipBudgetError)
    expect(() => openZip(garbleData(zip, 0))).toThrow(ZipBudgetError)
  })

  it('refuses more entries than the budget', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 2001; i++) files[`f${i}`] = new Uint8Array(0)
    expect(() => openZip(zipSync(files))).toThrow(ZipBudgetError)
  })

  it('accepts an ordinary package', () => {
    const zip = zipSync({ 'a.xml': strToU8('<a>text</a>'.repeat(1000)) })
    expect(() => checkZipBudget(readZipIndex(zip))).not.toThrow()
  })
})

describe('inflateZipEntry', () => {
  const text = 'The quick brown fox jumps over the lazy dog. '.repeat(2000)
  const zip = zipSync({ 'doc.xml': strToU8(text), 'stored.txt': [strToU8('plain'), { level: 0 }] })

  it('inflates deflated and stored entries', () => {
    const reader = openZip(zip)
    expect(new TextDecoder().decode(reader.read('doc.xml')!)).toBe(text)
    expect(new TextDecoder().decode(reader.read('stored.txt')!)).toBe('plain')
    expect(reader.read('missing.xml')).toBeNull()
  })

  it('returns only the first bytes when asked to truncate', () => {
    const head = openZip(zip).read('doc.xml', { maxBytes: 100, truncate: true })!
    expect(head.byteLength).toBe(100)
    expect(new TextDecoder().decode(head)).toBe(text.slice(0, 100))
  })

  it('refuses an entry that inflates past its declared size', () => {
    const lying = claimOriginalSize(zip, 0, 1000)
    const [entry] = readZipIndex(lying)
    expect(() => inflateZipEntry(lying, entry!)).toThrow(ZipBudgetError)
    expect(() => inflateZipEntry(lying, entry!, { maxBytes: 500, truncate: true })).toThrow(
      ZipBudgetError
    )
  })

  it('refuses an entry over the caller cap unless truncating', () => {
    const [entry] = readZipIndex(zip)
    expect(() => inflateZipEntry(zip, entry!, { maxBytes: 100 })).toThrow(ZipBudgetError)
  })

  it('reports a corrupt stream as a format error', () => {
    const [entry] = readZipIndex(garbleData(zip, 0))
    expect(() => inflateZipEntry(garbleData(zip, 0), entry!)).toThrow(ZipFormatError)
  })
})

describe('verifyZipSizes', () => {
  it('passes an honest archive and refuses one whose entry outgrows its index', () => {
    const zip = zipSync({ 'a.xml': strToU8('<row/>'.repeat(5000)), 'b.xml': strToU8('<b/>') })
    expect(() => verifyZipSizes(zip, readZipIndex(zip))).not.toThrow()
    const lying = claimOriginalSize(zip, 0, 64)
    expect(() => verifyZipSizes(lying, readZipIndex(lying))).toThrow(ZipBudgetError)
  })
})
