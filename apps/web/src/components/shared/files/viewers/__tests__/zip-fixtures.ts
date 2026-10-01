/**
 * Zip surgery for tests: rewrite what an archive's headers declare, so a
 * test can build the lying packages a parser must refuse.
 */

const CENTRAL = 0x02014b50

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

/** Offsets of the central directory header of every entry, in index order. */
function centralHeaders(zip: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i + 4 <= zip.length; i++) if (u32(zip, i) === CENTRAL) out.push(i)
  return out
}

function entryIndex(zip: Uint8Array, name: string): number {
  const decoder = new TextDecoder()
  const index = centralHeaders(zip).findIndex((at) => {
    const length = zip[at + 28]! | (zip[at + 29]! << 8)
    return decoder.decode(zip.subarray(at + 46, at + 46 + length)) === name
  })
  if (index < 0) throw new Error(`No entry ${name}`)
  return index
}

/**
 * Rewrites an entry's declared uncompressed size: in the central directory,
 * the local header, or both (the honest-looking lie).
 */
export function declareSize(
  zip: Uint8Array,
  name: string,
  size: number,
  where: 'both' | 'central' | 'local' = 'both'
): Uint8Array {
  const out = zip.slice()
  const central = centralHeaders(out)[entryIndex(out, name)]!
  if (where !== 'local') setU32(out, central + 24, size)
  if (where !== 'central') setU32(out, u32(out, central + 42) + 22, size)
  return out
}

/** Moves an entry's sizes to a data descriptor, as streaming zip writers do. */
export function deferSizes(zip: Uint8Array, name: string): Uint8Array {
  const out = zip.slice()
  const central = centralHeaders(out)[entryIndex(out, name)]!
  const local = u32(out, central + 42)
  out[local + 6] = out[local + 6]! | 0x08
  out[central + 8] = out[central + 8]! | 0x08
  setU32(out, local + 14, 0)
  setU32(out, local + 18, 0)
  setU32(out, local + 22, 0)
  return out
}

/** Renames an entry in its central directory header only (same length). */
export function renameInIndex(zip: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) throw new Error('Names must be the same length')
  const out = zip.slice()
  const central = centralHeaders(out)[entryIndex(out, from)]!
  out.set(new TextEncoder().encode(to), central + 46)
  return out
}
