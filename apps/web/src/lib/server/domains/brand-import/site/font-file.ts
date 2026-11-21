/**
 * What a font file says about itself: its format, its family and weight, the
 * embedding permission its maker set (OS/2 `fsType`), its licence text (name
 * IDs 13 and 14) and whether it holds the Latin letters. Read from the bytes
 * of a WOFF2, WOFF, TTF or OTF file. The bytes are a website's and untrusted:
 * every offset is checked, decompression is capped, and anything odd reads
 * as null, never a throw.
 */
import { brotliDecompressSync, inflateSync } from 'node:zlib'
import type { FontExtension } from '@/lib/shared/theme/font-uploads'

export interface FontFileFacts {
  format: FontExtension
  /** The typographic family (name ID 16), else the family (ID 1). */
  family: string | null
  /** `usWeightClass`: 400 regular, 700 bold. */
  weight: number | null
  italic: boolean
  /** A variable font's weight axis, lowest to highest. */
  weightRange: [number, number] | null
  /** The embedding permissions, or null when the file has no OS/2 table. */
  fsType: number | null
  /** The licence description (name ID 13). */
  licence: string
  /** The licence URL (name ID 14). */
  licenceUrl: string
  /** Whether it maps the Latin letters and digits; null when its character map is not one we read. */
  latin: boolean | null
  glyphs: number | null
}

/** How a font file may be used on a portal, as the file itself says. */
export type FontLicence = 'restricted' | 'open' | 'commercial'

/** The most a font may unpack to: well over any real web font. */
const MAX_UNPACKED = 12 * 1024 * 1024
const MAX_TABLES = 200
/** `fsType` bit 1: restricted-licence embedding, so the font may not be embedded or shared. */
const RESTRICTED = 0x0002

/**
 * An open licence, as its own files name it: the licence URL is one of the
 * licences' own addresses, or the description says the font is licensed under
 * one, by its full name and version. A bare "OFL" or "Apache" is not enough.
 */
const OPEN_LICENCE_URL =
  /^https?:\/\/(?:www\.)?(?:scripts\.sil\.org\/OFL|openfontlicense\.org|apache\.org\/licenses\/LICENSE-2\.0(?:\.txt|\.html)?)\/?$/i
const OPEN_LICENCE_TEXT =
  /\blicensed under the (?:SIL Open Font Licen[sc]e(?:,? Version 1\.1)?|Apache Licen[sc]e,? Version 2\.0)\b|\bSIL Open Font Licen[sc]e,? Version 1\.1\b/i
/** Words that make any mention of an open licence doubtful: such a font is held. */
const NOT_OPEN =
  /\b(?:not|never|no longer)\b[^.;]{0,60}\b(?:open font|ofl|apache)|\bcommercial\b|\bproprietary\b|\ball rights reserved\b|\bend[- ]user licen[sc]e\b|\beula\b|\bpurchas|\bpaid\b|\btrial\b|\bpersonal use\b|\bdesktop licen[sc]e\b|\bweb ?font licen[sc]e\b/i

/** The WOFF2 directory's known tags, by index. */
const WOFF2_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
] as const

/** The tables read; the rest of a file is never unpacked or looked at. */
const WANTED = new Set(['OS/2', 'name', 'cmap', 'maxp', 'fvar'])

type Tables = Map<string, Buffer>

const tagAt = (buf: Buffer, at: number) => buf.toString('latin1', at, at + 4)

/** A plain sfnt's tables (TTF, OTF), sliced in place. */
function sfntTables(buf: Buffer): Tables | null {
  if (buf.length < 12) return null
  const count = buf.readUInt16BE(4)
  if (count === 0 || count > MAX_TABLES || 12 + count * 16 > buf.length) return null
  const tables: Tables = new Map()
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    const tag = tagAt(buf, at)
    if (!WANTED.has(tag)) continue
    const offset = buf.readUInt32BE(at + 8)
    const length = buf.readUInt32BE(at + 12)
    if (offset + length > buf.length) return null
    tables.set(tag, buf.subarray(offset, offset + length))
  }
  return tables
}

/** A WOFF file's tables: each is stored whole or zlib-compressed on its own. */
function woffTables(buf: Buffer): Tables | null {
  if (buf.length < 44) return null
  const count = buf.readUInt16BE(12)
  if (count === 0 || count > MAX_TABLES || 44 + count * 20 > buf.length) return null
  const tables: Tables = new Map()
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20
    const tag = tagAt(buf, at)
    if (!WANTED.has(tag)) continue
    const offset = buf.readUInt32BE(at + 4)
    const packed = buf.readUInt32BE(at + 8)
    const length = buf.readUInt32BE(at + 12)
    if (offset + packed > buf.length || length > MAX_UNPACKED || packed > length) return null
    const stored = buf.subarray(offset, offset + packed)
    const table = packed < length ? inflateSync(stored, { maxOutputLength: length }) : stored
    if (table.length !== length) return null
    tables.set(tag, table)
  }
  return tables
}

/** A WOFF2 variable-length number (UIntBase128), and where the next byte is. */
function base128(buf: Buffer, at: number): { value: number; next: number } | null {
  let value = 0
  for (let i = 0; i < 5; i++) {
    if (at + i >= buf.length) return null
    const byte = buf[at + i]!
    if (i === 0 && byte === 0x80) return null
    if (value > 0x1ffffff) return null
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) return { value, next: at + i + 1 }
  }
  return null
}

/**
 * A WOFF2 file's tables. Its directory lists each table's length; the tables
 * themselves are one brotli stream, in directory order. The tables read here
 * are stored as they are (only glyf, loca and hmtx are ever transformed).
 */
function woff2Tables(buf: Buffer): Tables | null {
  if (buf.length < 48) return null
  // A collection holds several fonts: not a web font a site's text is set in.
  if (tagAt(buf, 4) === 'ttcf') return null
  const count = buf.readUInt16BE(12)
  const packed = buf.readUInt32BE(20)
  if (count === 0 || count > MAX_TABLES) return null
  const entries: { tag: string; length: number }[] = []
  let at = 48
  let total = 0
  for (let i = 0; i < count; i++) {
    if (at >= buf.length) return null
    const flags = buf[at++]!
    const index = flags & 0x3f
    const version = flags >> 6
    let tag: string
    if (index === 63) {
      if (at + 4 > buf.length) return null
      tag = tagAt(buf, at)
      at += 4
    } else tag = WOFF2_TAGS[index]!
    const original = base128(buf, at)
    if (!original) return null
    at = original.next
    let length = original.value
    // glyf and loca are transformed at version 0, every other table at any other version.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0
    if (transformed) {
      const stored = base128(buf, at)
      if (!stored) return null
      at = stored.next
      length = stored.value
    }
    total += length
    if (total > MAX_UNPACKED) return null
    entries.push({ tag, length })
  }
  if (at + packed > buf.length) return null
  const data = brotliDecompressSync(buf.subarray(at, at + packed), { maxOutputLength: total })
  if (data.length < total) return null
  const tables: Tables = new Map()
  let offset = 0
  for (const entry of entries) {
    if (WANTED.has(entry.tag)) tables.set(entry.tag, data.subarray(offset, offset + entry.length))
    offset += entry.length
  }
  return tables
}

function tablesOf(buf: Buffer): { format: FontExtension; tables: Tables } | null {
  if (buf.length < 12) return null
  const magic = tagAt(buf, 0)
  if (magic === 'wOF2') {
    const tables = woff2Tables(buf)
    return tables && { format: 'woff2', tables }
  }
  if (magic === 'wOFF') {
    const tables = woffTables(buf)
    return tables && { format: 'woff', tables }
  }
  if (magic === 'OTTO') {
    const tables = sfntTables(buf)
    return tables && { format: 'otf', tables }
  }
  if (magic === 'true' || buf.readUInt32BE(0) === 0x00010000) {
    const tables = sfntTables(buf)
    return tables && { format: 'ttf', tables }
  }
  return null
}

/** The name table's strings by ID, a Windows or Unicode record over a Macintosh one. */
function namesOf(table: Buffer | undefined, ids: readonly number[]): Map<number, string> {
  const names = new Map<number, string>()
  if (!table || table.length < 6) return names
  const count = table.readUInt16BE(2)
  const strings = table.readUInt16BE(4)
  if (6 + count * 12 > table.length) return names
  const rank = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12
    const platform = table.readUInt16BE(at)
    const language = table.readUInt16BE(at + 4)
    const id = table.readUInt16BE(at + 6)
    const length = table.readUInt16BE(at + 8)
    const offset = strings + table.readUInt16BE(at + 10)
    if (!ids.includes(id) || length === 0 || offset + length > table.length) continue
    const wide = platform === 0 || platform === 3
    if (!wide && platform !== 1) continue
    // English (United States) first, then any wide record, then a Macintosh one.
    const score = wide ? (platform === 3 && language === 0x409 ? 3 : 2) : 1
    if ((rank.get(id) ?? 0) >= score) continue
    const raw = table.subarray(offset, offset + length)
    const text = wide ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1')
    rank.set(id, score)
    // Control characters are no part of a name.
    names.set(
      id,
      [...text]
        .filter((char) => char.charCodeAt(0) >= 32)
        .join('')
        .trim()
    )
  }
  return names
}

/** Whether a character map's segments hold every one of `codes`; null when it has no map we read. */
function mapsAll(table: Buffer | undefined, codes: readonly number[]): boolean | null {
  if (!table || table.length < 4) return null
  const count = table.readUInt16BE(2)
  if (4 + count * 8 > table.length) return null
  let read = false
  const seen = new Set<number>()
  for (let i = 0; i < count; i++) {
    const offset = table.readUInt32BE(4 + i * 8 + 4)
    if (offset + 16 > table.length) continue
    const format = table.readUInt16BE(offset)
    const ranges: [number, number][] = []
    if (format === 4) {
      const segments = table.readUInt16BE(offset + 6) / 2
      const ends = offset + 14
      const starts = ends + segments * 2 + 2
      if (!Number.isInteger(segments) || starts + segments * 2 > table.length) continue
      for (let s = 0; s < segments; s++)
        ranges.push([table.readUInt16BE(starts + s * 2), table.readUInt16BE(ends + s * 2)])
    } else if (format === 12) {
      const groups = table.readUInt32BE(offset + 12)
      if (groups > 100_000 || offset + 16 + groups * 12 > table.length) continue
      for (let g = 0; g < groups; g++)
        ranges.push([
          table.readUInt32BE(offset + 16 + g * 12),
          table.readUInt32BE(offset + 20 + g * 12),
        ])
    } else continue
    read = true
    for (const code of codes)
      if (ranges.some(([start, end]) => code >= start && code <= end)) seen.add(code)
  }
  return read ? seen.size === codes.length : null
}

/** A variable font's weight axis, from its fvar table. */
function weightAxis(table: Buffer | undefined): [number, number] | null {
  if (!table || table.length < 16) return null
  const axes = table.readUInt16BE(4)
  const count = table.readUInt16BE(8)
  const size = table.readUInt16BE(10)
  if (size < 20 || count > 64 || axes + count * size > table.length) return null
  for (let i = 0; i < count; i++) {
    const at = axes + i * size
    if (tagAt(table, at) !== 'wght') continue
    const min = Math.round(table.readInt32BE(at + 4) / 65536)
    const max = Math.round(table.readInt32BE(at + 12) / 65536)
    return min >= 1 && max <= 1000 && min < max ? [min, max] : null
  }
  return null
}

/** The Latin letters and digits a font for a page's words must hold. */
const LATIN = [...'AEMZaemnz059'].map((char) => char.charCodeAt(0))

/** What the font file in `bytes` says about itself, or null when it is not a font we can read. */
export function readFontFile(bytes: Uint8Array): FontFileFacts | null {
  try {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const font = tablesOf(buf)
    if (!font) return null
    const { tables } = font
    const os2 = tables.get('OS/2')
    const names = namesOf(tables.get('name'), [1, 13, 14, 16])
    // A file with neither a name nor an OS/2 table says nothing we can go on.
    if (!os2 && names.size === 0) return null
    const maxp = tables.get('maxp')
    return {
      format: font.format,
      family: names.get(16) || names.get(1) || null,
      weight: os2 && os2.length >= 6 ? os2.readUInt16BE(4) : null,
      italic: !!os2 && os2.length >= 64 && (os2.readUInt16BE(62) & 0x01) !== 0,
      weightRange: weightAxis(tables.get('fvar')),
      fsType: os2 && os2.length >= 10 ? os2.readUInt16BE(8) : null,
      licence: names.get(13) ?? '',
      licenceUrl: names.get(14) ?? '',
      latin: mapsAll(tables.get('cmap'), LATIN),
      glyphs: maxp && maxp.length >= 6 ? maxp.readUInt16BE(4) : null,
    }
  } catch {
    return null
  }
}

/**
 * How the file says it may be used. Restricted comes first: a maker's own
 * "do not embed" outranks any licence text. A licence that is not plainly an
 * open one (named in full or by its own URL, with nothing that doubts it) is
 * a commercial font's, held until the person confirms it.
 */
export function fontLicence(
  facts: Pick<FontFileFacts, 'fsType' | 'licence' | 'licenceUrl'>
): FontLicence {
  if (facts.fsType !== null && (facts.fsType & RESTRICTED) !== 0) return 'restricted'
  if (NOT_OPEN.test(facts.licence) || NOT_OPEN.test(facts.licenceUrl)) return 'commercial'
  return OPEN_LICENCE_URL.test(facts.licenceUrl.trim()) || OPEN_LICENCE_TEXT.test(facts.licence)
    ? 'open'
    : 'commercial'
}
