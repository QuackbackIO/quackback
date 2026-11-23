/**
 * The site's app icon, for the workspace icon: the largest square image a
 * site declares (apple-touch-icon, manifest icons), never one too small to
 * stand as an icon, and the PNG inside an ICO when that is all it has.
 */
import { describe, expect, it } from 'vitest'
import { pngOf } from '@/lib/server/content/__tests__/image-fixtures'
import { MIN_ICON_PX, pngInIco, rankAppIcons } from '../app-icon'
import type { FaviconCandidate } from '../types'

const icon = (
  url: string,
  size: number | null,
  from: FaviconCandidate['from'] = 'icon',
  type: string | null = null
) => ({ url, size, type, from }) satisfies FaviconCandidate

describe('rankAppIcons', () => {
  it('tries the largest declared icons first, and none declared too small', () => {
    const ranked = rankAppIcons(
      [
        icon('https://a.test/32.png', 32),
        icon('https://a.test/192.png', 192, 'manifest'),
        icon('https://a.test/512.png', 512, 'manifest'),
        icon('https://a.test/76.png', 76),
        icon('https://a.test/touch.png', null, 'apple-touch-icon'),
        icon('https://a.test/any.ico', null, 'icon', 'image/x-icon'),
      ],
      'https://a.test/'
    )
    expect(ranked.slice(0, 3)).toEqual([
      'https://a.test/512.png',
      'https://a.test/192.png',
      'https://a.test/touch.png',
    ])
    expect(ranked).not.toContain('https://a.test/32.png')
    expect(ranked).not.toContain('https://a.test/76.png')
    expect(MIN_ICON_PX).toBe(120)
  })

  it('still tries /favicon.ico last, which may hold a large PNG', () => {
    expect(rankAppIcons([], 'https://a.test/page')).toEqual(['https://a.test/favicon.ico'])
  })
})

/** An ICO holding the given images (each a PNG or anything else), as browsers read them. */
function icoOf(images: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((image, i) => {
    const entry = 6 + 16 * i
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry)
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1)
    header.writeUInt32LE(image.data.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += image.data.length
  })
  return Buffer.concat([header, ...images.map((image) => image.data)])
}

describe('pngInIco', () => {
  it('takes the largest PNG an ICO holds', () => {
    const small = pngOf(32, 32)
    const large = pngOf(256, 256)
    const found = pngInIco(
      icoOf([
        { size: 32, data: small },
        { size: 256, data: large },
      ])
    )
    expect(found && Buffer.from(found).equals(large)).toBe(true)
  })

  it('turns the largest 32-bit bitmap an ICO holds into a PNG', () => {
    const side = 4
    // BITMAPINFOHEADER: height doubled (image and mask), 32 bits, then BGRA rows bottom-up.
    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0)
    header.writeInt32LE(side, 4)
    header.writeInt32LE(side * 2, 8)
    header.writeUInt16LE(1, 12)
    header.writeUInt16LE(32, 14)
    const pixels = Buffer.alloc(side * side * 4)
    for (let i = 0; i < side * side; i++) pixels.set([0x40, 0x20, 0xff, 0xff], i * 4) // BGRA red
    const mask = Buffer.alloc(side * 4)
    const png = pngInIco(icoOf([{ size: side, data: Buffer.concat([header, pixels, mask]) }]))
    expect(png).not.toBeNull()
    const buf = Buffer.from(png!)
    expect(buf.subarray(1, 4).toString()).toBe('PNG')
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([side, side])
  })

  it('finds nothing in an ICO of older bitmaps, or in bytes that are not an ICO', () => {
    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0)
    header.writeInt32LE(48, 4)
    header.writeInt32LE(96, 8)
    header.writeUInt16LE(8, 14)
    expect(
      pngInIco(icoOf([{ size: 48, data: Buffer.concat([header, Buffer.alloc(200)]) }]))
    ).toBeNull()
    expect(pngInIco(Buffer.from('not an icon'))).toBeNull()
  })
})
