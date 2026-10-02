/**
 * ISO base media file format boxes (MP4, MOV, M4A, HEIF, AVIF): a 32-bit
 * big-endian size, a four-character type, and a 64-bit size when the short
 * one is 1. Every read is bounds-checked; a box that claims to be smaller
 * than its own header or to run past its parent is a format error.
 */

export interface Box {
  type: string
  /** First byte of the box's payload. */
  start: number
  /** One past the box's last byte. */
  end: number
}

export function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) >>> 0) + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!)
}

export function u64be(b: Uint8Array, o: number): number {
  return u32be(b, o) * 0x100000000 + u32be(b, o + 4)
}

export function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!)
}

/**
 * Decode one box header at `offset` from the first bytes of the box.
 * `limit` is where the parent ends (a size of 0 means "to the parent's end").
 */
export function boxAt(
  header: Uint8Array,
  headerOffset: number,
  offset: number,
  limit: number
): Box | null {
  if (header.length - headerOffset < 8) return null
  const size32 = u32be(header, headerOffset)
  const type = fourcc(header, headerOffset + 4)
  let headerLength = 8
  let size: number
  if (size32 === 1) {
    if (header.length - headerOffset < 16) throw new Error('Truncated box header')
    size = u64be(header, headerOffset + 8)
    headerLength = 16
  } else if (size32 === 0) {
    size = limit - offset
  } else {
    size = size32
  }
  if (size < headerLength || offset + size > limit) throw new Error('Box size out of range')
  return { type, start: offset + headerLength, end: offset + size }
}

/** The direct children of a region already in memory. */
export function* childBoxes(bytes: Uint8Array, start: number, end: number): Generator<Box> {
  for (let p = start; p + 8 <= end;) {
    const box = boxAt(bytes, p, p, end)
    if (!box) return
    yield box
    p = box.end
  }
}

/** The first direct child of the given type, or null. */
export function findChild(bytes: Uint8Array, start: number, end: number, type: string): Box | null {
  for (const box of childBoxes(bytes, start, end)) if (box.type === type) return box
  return null
}
