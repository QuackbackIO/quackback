/**
 * PNG decode and encode: our own encoder round-trips, and files written by
 * another encoder (ImageMagick: truecolour, palette with transparency,
 * Adam7 interlaced, 2-bit greyscale) decode to the pixels it reports.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodePng, downscale, encodePng, type Image } from '../png'

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)))
const pixel = (img: Image, x: number, y: number) =>
  Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))

describe('png', () => {
  it('round-trips an RGBA image through our encoder', () => {
    const width = 37
    const height = 11
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < data.length; i++) data[i] = (i * 7919) % 256
    const back = decodePng(encodePng({ width, height, data }))
    expect(back.width).toBe(width)
    expect(back.height).toBe(height)
    expect(Array.from(back.data)).toEqual(Array.from(data))
  })

  it('encodes the same pixels to the same bytes', () => {
    const img = { width: 2, height: 1, data: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]) }
    expect(Array.from(encodePng(img))).toEqual(Array.from(encodePng(img)))
  })

  it('decodes a truecolour file from another encoder', () => {
    const img = decodePng(fixture('rgb.png'))
    expect([img.width, img.height]).toEqual([3, 2])
    expect(pixel(img, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(img, 1, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(img, 2, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(img, 0, 1)).toEqual([255, 255, 255, 255])
    expect(pixel(img, 1, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(img, 2, 1)).toEqual([0, 88, 163, 255])
  })

  it('decodes a palette with transparency', () => {
    const img = decodePng(fixture('palette-alpha.png'))
    expect(pixel(img, 0, 0)[3]).toBe(0)
    expect(pixel(img, 1, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(img, 0, 1)).toEqual([0, 0, 255, 255])
    expect(pixel(img, 1, 1)).toEqual([255, 0, 0, 255])
  })

  it('decodes an Adam7 interlaced file', () => {
    const img = decodePng(fixture('interlaced.png'))
    const expected = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'interlaced.rgb.json'), 'utf8')
    )
    const rgb: number[] = []
    for (let i = 0; i < img.width * img.height; i++)
      rgb.push(...Array.from(img.data.subarray(i * 4, i * 4 + 3)))
    expect([img.width, img.height]).toEqual([9, 7])
    expect(rgb).toEqual(expected)
  })

  it('decodes 2-bit greyscale to full range', () => {
    const img = decodePng(fixture('grey2.png'))
    expect([0, 1, 2, 3].map((x) => pixel(img, x, 0)[0])).toEqual([0, 85, 170, 255])
  })

  it('refuses what is not a PNG', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow('not a PNG')
  })

  it('downscales by area average', () => {
    const data = new Uint8Array([
      0, 0, 0, 255, 255, 255, 255, 255, 100, 100, 100, 255, 100, 100, 100, 255,
    ])
    const small = downscale({ width: 2, height: 2, data }, 2)
    expect([small.width, small.height]).toEqual([1, 1])
    expect(Array.from(small.data)).toEqual([114, 114, 114, 255])
  })
})
