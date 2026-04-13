import { describe, it, expect } from 'vitest'
import { sniffImageMime, ALLOWED_REHOST_MIMES } from '../magic-bytes'

const bytes = (...values: number[]) => Buffer.from(values)

describe('sniffImageMime', () => {
  it('detects PNG from magic bytes', () => {
    const buf = Buffer.concat([
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      Buffer.alloc(32),
    ])
    expect(sniffImageMime(buf)).toBe('image/png')
  })

  it('detects JPEG from magic bytes', () => {
    const buf = Buffer.concat([bytes(0xff, 0xd8, 0xff, 0xe0), Buffer.alloc(32)])
    expect(sniffImageMime(buf)).toBe('image/jpeg')
  })

  it('detects GIF87a and GIF89a', () => {
    expect(sniffImageMime(Buffer.from('GIF87a' + '\0'.repeat(32)))).toBe('image/gif')
    expect(sniffImageMime(Buffer.from('GIF89a' + '\0'.repeat(32)))).toBe('image/gif')
  })

  it('detects WebP from RIFF + WEBP marker', () => {
    const header = Buffer.from('RIFF\0\0\0\0WEBP' + '\0'.repeat(20))
    expect(sniffImageMime(header)).toBe('image/webp')
  })

  it('detects AVIF from ftyp box', () => {
    // 4 bytes size, "ftyp", "avif" or "avis"
    const header = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftypavif'),
      Buffer.alloc(20),
    ])
    expect(sniffImageMime(header)).toBe('image/avif')
  })

  it('detects AVIF from ftyp avis (sequence) variant', () => {
    const header = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftypavis'),
      Buffer.alloc(20),
    ])
    expect(sniffImageMime(header)).toBe('image/avif')
  })

  it('returns null for unknown bytes', () => {
    expect(sniffImageMime(Buffer.from('not an image at all'))).toBeNull()
  })

  it('returns null for buffers that are too short', () => {
    expect(sniffImageMime(Buffer.alloc(4))).toBeNull()
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull()
  })

  it('returns null for SVG content (we never sniff svg as an allowed format)', () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="..."></svg>')
    expect(sniffImageMime(svg)).toBeNull()
  })
})

describe('ALLOWED_REHOST_MIMES', () => {
  it('contains the five image formats we rehost', () => {
    expect(ALLOWED_REHOST_MIMES).toEqual(
      new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
    )
  })
})
