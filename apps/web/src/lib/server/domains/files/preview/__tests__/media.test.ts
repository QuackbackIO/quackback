import { describe, it, expect } from 'vitest'
import { isoBmffDurationMs, deriveMediaPreview, type RangeReader } from '../media'

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length)
  new DataView(out.buffer).setUint32(0, out.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(body, 8)
  return out
}

/** A box using the 64-bit `largesize` form (size field 1). */
function largeBox(type: string, bodyLength: number): Uint8Array {
  const out = new Uint8Array(16 + bodyLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, 1)
  out.set(new TextEncoder().encode(type), 4)
  view.setBigUint64(8, BigInt(out.length))
  return out
}

function mvhdV0(timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(100)
  const view = new DataView(body.buffer)
  view.setUint32(12, timescale)
  view.setUint32(16, duration)
  return box('mvhd', body)
}

function mvhdV1(timescale: number, duration: bigint): Uint8Array {
  const body = new Uint8Array(112)
  body[0] = 1
  const view = new DataView(body.buffer)
  view.setUint32(20, timescale)
  view.setBigUint64(24, duration)
  return box('mvhd', body)
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const ftyp = box('ftyp', new TextEncoder().encode('isom\0\0\0\0isomavc1'))

/** A reader over a buffer that records every range asked for. */
function readerOver(bytes: Uint8Array) {
  const reads: Array<[number, number]> = []
  const read: RangeReader = async (offset, length) => {
    reads.push([offset, length])
    return bytes.slice(offset, offset + length)
  }
  return { read, reads }
}

describe('isoBmffDurationMs', () => {
  it('reads a version 0 mvhd after a large mdat without reading the media', async () => {
    const mdat = box('mdat', new Uint8Array(5 * 1024 * 1024))
    const moov = box('moov', concat(mvhdV0(1000, 65_432), box('trak', new Uint8Array(32))))
    const file = concat(ftyp, mdat, moov)
    const { read, reads } = readerOver(file)
    expect(await isoBmffDurationMs(read, file.length)).toBe(65_432)
    expect(Math.max(...reads.map(([, length]) => length))).toBeLessThan(1024 * 1024)
  })

  it('reads a version 1 mvhd with 64-bit duration, moov first', async () => {
    const moov = box('moov', mvhdV1(90_000, 90_000n * 7200n))
    const file = concat(ftyp, moov, box('mdat', new Uint8Array(64)))
    const { read } = readerOver(file)
    expect(await isoBmffDurationMs(read, file.length)).toBe(7_200_000)
  })

  it('walks past a box in the 64-bit size form', async () => {
    const file = concat(ftyp, largeBox('mdat', 4096), box('moov', mvhdV0(600, 1800)))
    const { read } = readerOver(file)
    expect(await isoBmffDurationMs(read, file.length)).toBe(3000)
  })

  it('returns null with no movie header, an unknown duration or a zero timescale', async () => {
    const noMoov = concat(ftyp, box('mdat', new Uint8Array(16)))
    expect(await isoBmffDurationMs(readerOver(noMoov).read, noMoov.length)).toBeNull()
    const unknown = concat(ftyp, box('moov', mvhdV0(1000, 0xffffffff)))
    expect(await isoBmffDurationMs(readerOver(unknown).read, unknown.length)).toBeNull()
    const zero = concat(ftyp, box('moov', mvhdV0(0, 1000)))
    expect(await isoBmffDurationMs(readerOver(zero).read, zero.length)).toBeNull()
  })

  it('refuses a box whose size is smaller than its header', async () => {
    const broken = concat(ftyp, new Uint8Array([0, 0, 0, 4, 0x6d, 0x64, 0x61, 0x74]))
    await expect(isoBmffDurationMs(readerOver(broken).read, broken.length)).rejects.toThrow()
  })

  it('refuses a truncated mvhd', async () => {
    const truncated = concat(ftyp, box('moov', box('mvhd', new Uint8Array(10))))
    await expect(isoBmffDurationMs(readerOver(truncated).read, truncated.length)).rejects.toThrow()
  })
})

describe('deriveMediaPreview', () => {
  it('records the duration, or nothing when there is none', async () => {
    const file = concat(ftyp, box('moov', mvhdV0(1000, 12_345)))
    expect(await deriveMediaPreview(readerOver(file).read, file.length)).toEqual({
      status: 'ready',
      meta: { durationMs: 12_345 },
    })
    const none = concat(ftyp, box('mdat', new Uint8Array(8)))
    expect(await deriveMediaPreview(readerOver(none).read, none.length)).toEqual({
      status: 'none',
      meta: {},
    })
  })
})
