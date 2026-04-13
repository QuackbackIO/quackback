/**
 * Image magic-byte sniffer for the content rehoster.
 *
 * Parses the first few bytes of a response body and returns the detected
 * MIME type only if it matches one of our allowed image formats. The caller
 * uses this to verify that a server-reported Content-Type header wasn't
 * spoofed: if `header !== sniffed` or `sniffed === null`, reject the image.
 *
 * SVG is deliberately never returned — even if the bytes look XML-ish, we
 * don't allow SVG because it can carry script payloads.
 */

export const ALLOWED_REHOST_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])

function startsWithAt(buf: Buffer, offset: number, pattern: number[]): boolean {
  if (buf.length < offset + pattern.length) return false
  for (let i = 0; i < pattern.length; i++) {
    if (buf[offset + i] !== pattern[i]) return false
  }
  return true
}

/**
 * Sniff the image MIME type from the first ~16 bytes of the buffer.
 * Returns one of ALLOWED_REHOST_MIMES or null.
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 8) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWithAt(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (startsWithAt(buf, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  // GIF: "GIF87a" or "GIF89a"
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a') return 'image/gif'
  if (buf.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  // AVIF: ...."ftyp""avif" or ...."ftyp""avis" at offset 4
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return null
}
