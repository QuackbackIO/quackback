import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  readZipIndex,
  checkZipBudget,
  checkZipLocalHeader,
  openZip,
  inflateZipEntry,
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

/** A zip fflate wrote (no comment), with `comment` appended to its end record. */
function withComment(zip: Uint8Array, comment: Uint8Array): Uint8Array {
  const eocd = zip.length - 22
  const out = new Uint8Array(zip.length + comment.length)
  out.set(zip)
  out.set(comment, zip.length)
  out[eocd + 20] = comment.length & 0xff
  out[eocd + 21] = comment.length >>> 8
  return out
}

/** Rewrite a field of one entry's local header, leaving its index record alone. */
function editLocalHeader(
  zip: Uint8Array,
  entryIndex: number,
  edit: (out: Uint8Array, local: number) => void
): Uint8Array {
  const out = zip.slice()
  const central = centralHeaders(out)[entryIndex]!
  edit(out, u32(out, central + 42))
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

describe('openZip: one index, read one way', () => {
  const text = '<row/>'.repeat(5000)
  const zip = zipSync({ 'a.xml': strToU8(text), 'b.xml': strToU8('<b/>') })

  it('refuses a zip with a second end record after the one it reads', () => {
    // Too close to the end for the index reader to take, so another reader
    // scanning from the very end would read a different index.
    const tail = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0])
    expect(() => openZip(withComment(zip, tail))).toThrow(ZipFormatError)
  })

  it('reads a zip whose comment holds no end record', () => {
    const reader = openZip(withComment(zip, strToU8('made by a spreadsheet app')))
    expect(new TextDecoder().decode(reader.read('a.xml')!)).toBe(text)
  })

  it('refuses an entry whose local header disagrees with its index', () => {
    const lies = [
      editLocalHeader(zip, 0, (out, local) => setU32(out, local + 22, 64)),
      editLocalHeader(zip, 0, (out, local) => setU32(out, local + 18, 10)),
      editLocalHeader(zip, 0, (out, local) => (out[local + 8] = 0)),
    ]
    for (const lying of lies) {
      expect(() => openZip(lying).read('a.xml')).toThrow(ZipFormatError)
    }
    // Another entry, whose headers agree, still reads.
    expect(new TextDecoder().decode(openZip(lies[0]!).read('b.xml')!)).toBe('<b/>')
  })

  it('accepts a local header that leaves its sizes to a data descriptor', () => {
    const deferred = editLocalHeader(zip, 0, (out, local) => {
      out[local + 6] = out[local + 6]! | 0x08
      setU32(out, local + 14, 0)
      setU32(out, local + 18, 0)
      setU32(out, local + 22, 0)
    })
    expect(new TextDecoder().decode(openZip(deferred).read('a.xml')!)).toBe(text)
  })

  it('refuses a deferred-size local header that records other sizes', () => {
    const lying = editLocalHeader(zip, 0, (out, local) => {
      out[local + 6] = out[local + 6]! | 0x08
      setU32(out, local + 22, 64)
    })
    expect(() => openZip(lying).read('a.xml')).toThrow(ZipFormatError)
  })

  it('refuses an encrypted entry', () => {
    const encrypted = editLocalHeader(zip, 0, (out, local) => {
      out[local + 6] = out[local + 6]! | 0x01
    })
    expect(() => openZip(encrypted).read('a.xml')).toThrow(ZipFormatError)
    expect(new TextDecoder().decode(openZip(encrypted).read('b.xml')!)).toBe('<b/>')
  })
})

describe('checkZipLocalHeader', () => {
  const zip = zipSync({ 'a.xml': strToU8('<a/>'.repeat(100)), 'logs/': new Uint8Array(0) })

  it('passes headers that agree with the index, folders included', () => {
    for (const entry of readZipIndex(zip))
      expect(() => checkZipLocalHeader(zip, entry)).not.toThrow()
  })

  it('refuses an entry whose local header is missing or disagrees', () => {
    const [entry] = readZipIndex(zip)
    expect(() => checkZipLocalHeader(zip, { ...entry!, localHeaderOffset: 1 })).toThrow(
      ZipFormatError
    )
    expect(() => checkZipLocalHeader(zip, { ...entry!, compression: 0 })).toThrow(ZipFormatError)
    expect(() => checkZipLocalHeader(zip, { ...entry!, originalSize: 401 })).toThrow(ZipFormatError)
    expect(() => checkZipLocalHeader(zip, { ...entry!, compressedSize: zip.length })).toThrow(
      ZipFormatError
    )
  })
})
