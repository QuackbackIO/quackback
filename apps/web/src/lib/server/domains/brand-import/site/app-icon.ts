/**
 * The site's app icon, for the workspace icon: the square mark a site
 * declares for home screens and tabs (apple-touch-icon, manifest icons,
 * sized icons). The favicon a browser tab shows is often 16 or 32 pixels,
 * too small to stand as an icon, so this ranks for size, not for a tab.
 */
import { deflateSync } from 'node:zlib'
import type { FaviconCandidate } from './types'

/** The smallest icon worth using: an apple-touch-icon is 120 or more. */
export const MIN_ICON_PX = 120
/** Past this, a larger icon adds nothing but bytes. */
const ENOUGH_PX = 512

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Icon URLs in the order worth trying: declared sizes from the largest down
 * to the floor (anything over 512 last among them), then the undeclared
 * apple-touch and manifest icons (usually 180 or more), then any other
 * undeclared icon, then /favicon.ico, which may hold a large PNG. An icon
 * declared smaller than the floor is never tried.
 */
export function rankAppIcons(icons: FaviconCandidate[], pageUrl: string): string[] {
  const sized = icons
    .filter((icon) => icon.size !== null && icon.size >= MIN_ICON_PX)
    .sort((a, b) => {
      const over = (size: number) => (size > ENOUGH_PX ? 1 : 0)
      return over(a.size!) - over(b.size!) || b.size! - a.size!
    })
  const unsized = icons.filter((icon) => icon.size === null)
  const declared = unsized.filter((icon) => icon.from !== 'icon')
  const other = unsized.filter((icon) => icon.from === 'icon')
  const ordered = [...sized, ...declared, ...other].map((icon) => icon.url)
  try {
    ordered.push(new URL('/favicon.ico', pageUrl).href)
  } catch {
    // No page URL to resolve against.
  }
  return [...new Set(ordered)]
}

/**
 * The largest image an ICO holds, as PNG bytes, or null. Modern ICOs keep
 * their large sizes as embedded PNGs; a 32-bit bitmap entry (Windows' own
 * 256px icons) is turned into a PNG here. Older, paletted bitmaps are left alone.
 */
export function pngInIco(bytes: Uint8Array): Uint8Array | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null
  const count = buf.readUInt16LE(4)
  let best: { size: number; data: Buffer } | null = null
  for (let i = 0; i < count; i++) {
    const entry = 6 + 16 * i
    if (entry + 16 > buf.length) break
    const size = buf.readUInt8(entry) || 256
    const length = buf.readUInt32LE(entry + 8)
    const offset = buf.readUInt32LE(entry + 12)
    if (offset + length > buf.length || length < PNG_SIGNATURE.length) continue
    const data = buf.subarray(offset, offset + length)
    const usable = data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) || isBitmap32(data)
    if (usable && (!best || size > best.size)) best = { size, data }
  }
  if (!best) return null
  if (best.data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
    return new Uint8Array(best.data)
  return bitmapToPng(best.data)
}

const BITMAP_HEADER = 40
const isBitmap32 = (data: Buffer) =>
  data.length >= BITMAP_HEADER &&
  data.readUInt32LE(0) === BITMAP_HEADER &&
  data.readUInt16LE(14) === 32

/** A 32-bit ICO bitmap (BGRA rows, bottom-up, height doubled for the mask) as a PNG. */
function bitmapToPng(data: Buffer): Uint8Array | null {
  const width = data.readInt32LE(4)
  const height = Math.abs(data.readInt32LE(8)) / 2
  if (width <= 0 || height <= 0 || width > 1024 || height > 1024) return null
  const rowBytes = width * 4
  if (BITMAP_HEADER + rowBytes * height > data.length) return null
  // PNG rows: a filter byte (none) then RGBA, top-down.
  const raw = Buffer.alloc((rowBytes + 1) * height)
  for (let y = 0; y < height; y++) {
    const from = BITMAP_HEADER + (height - 1 - y) * rowBytes
    const to = y * (rowBytes + 1) + 1
    for (let x = 0; x < width; x++) {
      const b = data[from + x * 4]!
      const g = data[from + x * 4 + 1]!
      const r = data[from + x * 4 + 2]!
      const a = data[from + x * 4 + 3]!
      raw.set([r, g, b, a], to + x * 4)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA, no interlace
  return new Uint8Array(
    Buffer.concat([
      PNG_SIGNATURE,
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    ])
  )
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function pngChunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  let crc = 0xffffffff
  for (const byte of Buffer.concat([head.subarray(4), body]))
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0)
  return Buffer.concat([head, body, tail])
}
