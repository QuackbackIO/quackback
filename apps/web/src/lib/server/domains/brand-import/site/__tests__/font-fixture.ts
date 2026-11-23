/**
 * A tiny hand-built font for tests: an sfnt with OS/2, name, cmap and maxp
 * tables, and the same font wrapped as WOFF and WOFF2.
 */
import { brotliCompressSync, deflateSync } from 'node:zlib'

export interface FixtureFont {
  family?: string
  weight?: number
  fsType?: number
  licence?: string
  licenceUrl?: string
  /** Character ranges the font maps; the Latin letters and digits by default. */
  ranges?: [number, number][]
  /** A weight axis, for a variable font. */
  axis?: [number, number]
  /** Padding, to make a file of a given size. */
  padding?: number
}

const u16 = (...values: number[]) => {
  const buf = Buffer.alloc(values.length * 2)
  values.forEach((value, i) => buf.writeUInt16BE(value & 0xffff, i * 2))
  return buf
}
const u32 = (...values: number[]) => {
  const buf = Buffer.alloc(values.length * 4)
  values.forEach((value, i) => buf.writeUInt32BE(value >>> 0, i * 4))
  return buf
}

function tablesOf(font: FixtureFont): [string, Buffer][] {
  const os2 = Buffer.alloc(96)
  os2.writeUInt16BE(4, 0)
  os2.writeUInt16BE(font.weight ?? 400, 4)
  os2.writeUInt16BE(font.fsType ?? 0, 8)

  const names: [number, string][] = [[1, font.family ?? 'Calibre']]
  if (font.licence) names.push([13, font.licence])
  if (font.licenceUrl) names.push([14, font.licenceUrl])
  const strings = names.map(([, text]) => Buffer.from(text, 'utf16le').swap16())
  let offset = 0
  const records = names.map(([id], i) => {
    const record = u16(3, 1, 0x409, id, strings[i]!.length, offset)
    offset += strings[i]!.length
    return record
  })
  const name = Buffer.concat([u16(0, names.length, 6 + names.length * 12), ...records, ...strings])

  const ranges = [
    ...(font.ranges ?? [
      [0x30, 0x39],
      [0x41, 0x5a],
      [0x61, 0x7a],
    ]),
    [0xffff, 0xffff],
  ] as [number, number][]
  const n = ranges.length
  const sub = Buffer.concat([
    u16(4, 16 + n * 8, 0, n * 2, 0, 0, 0),
    u16(...ranges.map(([, end]) => end)),
    u16(0),
    u16(...ranges.map(([start]) => start)),
    u16(...ranges.map(() => 0)),
    u16(...ranges.map(() => 0)),
  ])
  const cmap = Buffer.concat([u16(0, 1, 3, 1), u32(12), sub])

  const maxp = Buffer.concat([u32(0x00005000), u16(120)])
  const tables: [string, Buffer][] = [
    ['OS/2', os2],
    ['cmap', cmap],
    ['maxp', maxp],
    ['name', name],
  ]
  if (font.axis) {
    const axis = Buffer.concat([
      Buffer.from('wght', 'latin1'),
      u32(font.axis[0] * 65536, 400 * 65536, font.axis[1] * 65536),
      u16(0, 256),
    ])
    tables.push(['fvar', Buffer.concat([u16(1, 0, 16, 2, 1, 20, 0, 0), axis])])
  }
  if (font.padding) tables.push(['zpad', Buffer.alloc(font.padding, 7)])
  return tables
}

export function ttf(font: FixtureFont = {}, magic = 0x00010000): Uint8Array {
  const tables = tablesOf(font)
  let offset = 12 + tables.length * 16
  const directory = tables.map(([tag, data]) => {
    const entry = Buffer.concat([Buffer.from(tag, 'latin1'), u32(0, offset, data.length)])
    offset += data.length
    return entry
  })
  return Buffer.concat([
    u32(magic),
    u16(tables.length, 0, 0, 0),
    ...directory,
    ...tables.map(([, data]) => data),
  ])
}

export const otf = (font: FixtureFont = {}) => ttf(font, 0x4f54544f)

export function woff(font: FixtureFont = {}): Uint8Array {
  const tables = tablesOf(font)
  let offset = 44 + tables.length * 20
  const stored = tables.map(([, data]) => {
    const packed = deflateSync(data)
    return packed.length < data.length ? packed : data
  })
  const directory = tables.map(([tag, data], i) => {
    const entry = Buffer.concat([
      Buffer.from(tag, 'latin1'),
      u32(offset, stored[i]!.length, data.length, 0),
    ])
    offset += stored[i]!.length
    return entry
  })
  const header = Buffer.concat([
    Buffer.from('wOFF', 'latin1'),
    u32(0x00010000, offset),
    u16(tables.length, 0),
    u32(0, 0, 0, 0, 0, 0, 0).subarray(0, 28),
  ])
  return Buffer.concat([header.subarray(0, 44), ...directory, ...stored])
}

const WOFF2_INDEX: Record<string, number> = { cmap: 0, maxp: 4, name: 5, 'OS/2': 6, fvar: 47 }

function base128(value: number): Buffer {
  const bytes = [value & 0x7f]
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80)
  return Buffer.from(bytes)
}

export function woff2(font: FixtureFont = {}): Uint8Array {
  const tables = tablesOf(font)
  const directory = tables.map(([tag, data]) => {
    const index = WOFF2_INDEX[tag]
    return index === undefined
      ? Buffer.concat([Buffer.from([63]), Buffer.from(tag, 'latin1'), base128(data.length)])
      : Buffer.concat([Buffer.from([index]), base128(data.length)])
  })
  const packed = brotliCompressSync(Buffer.concat(tables.map(([, data]) => data)))
  const header = Buffer.concat([
    Buffer.from('wOF2', 'latin1'),
    u32(0x00010000, 0),
    u16(tables.length, 0),
    u32(0, packed.length),
    u16(1, 0),
    u32(0, 0, 0, 0, 0),
  ])
  return Buffer.concat([header, ...directory, packed])
}
