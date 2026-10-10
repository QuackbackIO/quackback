import { describe, expect, it } from 'vitest'
import { imageDimensions } from '../image-dimensions'
import { icoOf, pngOf } from './image-fixtures'

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff]
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const ascii = (s: string) => [...Buffer.from(s, 'ascii')]

describe('imageDimensions', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(imageDimensions(pngOf(180, 120), 'image/png')).toEqual({ width: 180, height: 120 })
    expect(imageDimensions(pngOf(5000, 5000), 'image/png')).toEqual({ width: 5000, height: 5000 })
  })

  it('reads GIF dimensions from the logical screen', () => {
    const gif = Buffer.from([...ascii('GIF89a'), ...u16le(300), ...u16le(64), 0, 0, 0])
    expect(imageDimensions(gif, 'image/gif')).toEqual({ width: 300, height: 64 })
  })

  it('reads lossy, lossless and extended WebP dimensions', () => {
    const riff = (chunk: string, body: number[]) =>
      Buffer.from([
        ...ascii('RIFF'),
        ...u32be(0),
        ...ascii('WEBP'),
        ...ascii(chunk),
        ...u32be(0),
        ...body,
      ])
    const lossy = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(256), ...u16le(128)])
    expect(imageDimensions(lossy, 'image/webp')).toEqual({ width: 256, height: 128 })
    // Lossless packs 14-bit width-1 and height-1 after the 0x2f signature.
    const w = 199,
      h = 99
    const bits = w | (h << 14)
    const lossless = riff('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >> 24) & 0xff,
    ])
    expect(imageDimensions(lossless, 'image/webp')).toEqual({ width: 200, height: 100 })
    const extended = riff('VP8X', [0, 0, 0, 0, ...u24le(511), ...u24le(255)])
    expect(imageDimensions(extended, 'image/webp')).toEqual({ width: 512, height: 256 })
  })

  it('walks JPEG segments to the first frame header', () => {
    const jpeg = Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      ...u16be(6),
      1,
      2,
      3,
      4,
      0xff,
      0xc2,
      ...u16be(11),
      8,
      ...u16be(90),
      ...u16be(160),
      3,
      0,
      0,
    ])
    expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 160, height: 90 })
  })

  it('reads the largest ICO directory entry, with 0 meaning 256', () => {
    expect(imageDimensions(icoOf(16, 0), 'image/x-icon')).toEqual({ width: 256, height: 256 })
    expect(imageDimensions(icoOf(32), 'image/x-icon')).toEqual({ width: 32, height: 32 })
  })

  it('returns null for truncated, mismatched, zero-sized and unsupported images', () => {
    expect(imageDimensions(pngOf(10, 10).subarray(0, 20), 'image/png')).toBeNull()
    expect(imageDimensions(pngOf(10, 10), 'image/gif')).toBeNull()
    expect(imageDimensions(pngOf(0, 10), 'image/png')).toBeNull()
    expect(imageDimensions(Buffer.from([0, 0, 1, 0, 0, 0]), 'image/x-icon')).toBeNull()
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull()
    expect(imageDimensions(Buffer.alloc(64), 'image/avif')).toBeNull()
  })
})
