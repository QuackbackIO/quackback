/**
 * Pixel dimensions from an image's own header bytes, for the sniffed raster
 * formats the rehoster accepts. Pure and bounded: it reads only the bytes it
 * needs and returns null for anything truncated, zero-sized or unsupported.
 */
export interface ImageDimensions {
  width: number
  height: number
}

function sized(width: number, height: number): ImageDimensions | null {
  return width > 0 && height > 0 ? { width, height } : null
}

function png(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return sized(buf.readUInt32BE(16), buf.readUInt32BE(20))
}

function gif(buf: Buffer): ImageDimensions | null {
  if (buf.length < 10 || !/^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return null
  return sized(buf.readUInt16LE(6), buf.readUInt16LE(8))
}

function webp(buf: Buffer): ImageDimensions | null {
  if (buf.length < 16 || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') {
    if (buf.length < 30 || buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null
    return sized(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff)
  }
  if (chunk === 'VP8L') {
    if (buf.length < 25 || buf[20] !== 0x2f) return null
    const bits = buf.readUInt32LE(21)
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X' && buf.length >= 30)
    return sized(buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1)
  return null
}

const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function jpeg(buf: Buffer): ImageDimensions | null {
  let offset = 2
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null
    const marker = buf[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null
    const length = buf.readUInt16BE(offset + 2)
    if (length < 2) return null
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 9 > buf.length) return null
      return sized(buf.readUInt16BE(offset + 7), buf.readUInt16BE(offset + 5))
    }
    offset += 2 + length
  }
  return null
}

function ico(buf: Buffer): ImageDimensions | null {
  if (buf.length < 6) return null
  const count = buf.readUInt16LE(4)
  if (count === 0 || buf.length < 6 + count * 16) return null
  let best: ImageDimensions | null = null
  for (let entry = 0; entry < count; entry++) {
    const width = buf[6 + entry * 16] || 256
    const height = buf[7 + entry * 16] || 256
    if (!best || width * height > best.width * best.height) best = { width, height }
  }
  return best
}

/** Dimensions for a buffer whose MIME type was already sniffed from its bytes. */
export function imageDimensions(buf: Buffer, mime: string): ImageDimensions | null {
  switch (mime) {
    case 'image/png':
      return png(buf)
    case 'image/gif':
      return gif(buf)
    case 'image/webp':
      return webp(buf)
    case 'image/jpeg':
      return jpeg(buf)
    case 'image/x-icon':
      return ico(buf)
    default:
      return null
  }
}
