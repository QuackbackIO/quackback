/**
 * Screenshots to pixels: a JPEG (as the builder sends them, 4:2:0 chroma)
 * and a PNG decode from data URLs, and a retina capture is halved for the
 * model.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deltaE00, type RGB } from '../color'
import { decodeImage, decodeDataUrl, modelImage } from '../image'
import { decodeJpeg } from '../jpeg'
import { decodePng, type Image } from '../png'

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)))
const rgbAt = (img: Image, x: number, y: number): RGB => {
  const o = (y * img.width + x) * 4
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
}
const dataUrl = (mime: string, bytes: Uint8Array) =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`

describe('jpeg', () => {
  it('decodes a JPEG from another encoder to RGBA', () => {
    const img = decodeJpeg(fixture('flat.jpg'))
    expect([img.width, img.height]).toEqual([32, 16])
    expect(img.data.length).toBe(32 * 16 * 4)
    // Away from the seam, each half keeps its colour.
    expect(deltaE00(rgbAt(img, 4, 8), [0x00, 0x58, 0xa3])).toBeLessThan(2)
    expect(deltaE00(rgbAt(img, 27, 8), [0xff, 0xdb, 0x00])).toBeLessThan(2)
    expect(img.data[3]).toBe(255)
  })

  it('refuses what is not a JPEG', () => {
    expect(() => decodeJpeg(fixture('rgb.png'))).toThrow('not a JPEG')
  })
})

describe('decoding screenshots', () => {
  it('tells PNG from JPEG by their bytes, whatever the data URL says', () => {
    expect(decodeDataUrl(dataUrl('image/jpeg', fixture('flat.jpg'))).width).toBe(32)
    expect(decodeDataUrl(dataUrl('image/jpeg', fixture('rgb.png'))).width).toBe(3)
    expect(decodeImage(fixture('rgb.png'))).toEqual(decodePng(fixture('rgb.png')))
  })

  it('refuses other images and other URLs', () => {
    expect(() => decodeImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toThrow(
      'unsupported image format'
    )
    expect(() => decodeDataUrl('https://example.com/a.png')).toThrow('not a base64 data URL')
  })
})

describe('the image for the model', () => {
  const blank = (width: number, height: number): Image => ({
    width,
    height,
    data: new Uint8Array(width * height * 4).fill(255),
  })

  it('halves a retina capture', () => {
    const m = modelImage(blank(2880, 40))
    expect(m.scale).toBe(2)
    expect([m.image.width, m.image.height]).toEqual([1440, 20])
    expect(decodePng(m.png).width).toBe(1440)
  })

  it('keeps a 1x capture as it is', () => {
    const m = modelImage(blank(1440, 20))
    expect(m.scale).toBe(1)
    expect(m.image.width).toBe(1440)
  })
})
