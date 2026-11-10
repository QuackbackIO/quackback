import { describe, expect, it } from 'vitest'
import { decodePng } from '../../extract/png'
import { CARD, drawShareCard, drawSquareIcon, encodeShareCard } from '../render'

const rgbAt = (img: { width: number; data: Uint8Array }, x: number, y: number) => {
  const o = (y * img.width + x) * 4
  return [img.data[o], img.data[o + 1], img.data[o + 2]]
}

/** A solid square image, as a stored icon decodes to. */
const solid = (size: number, rgb: [number, number, number]) => {
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i)
  return { width: size, height: size, data }
}

const base = {
  background: '#0c862c',
  ink: '#ffffff',
  accent: '#ffd43b',
  accentInk: '#000000',
  title: 'Acme',
  pageName: 'Roadmap',
  headingFont: 'inter',
  headingWeight: 700,
  bodyFont: 'inter',
  icon: null,
}

/** Pixels in a box whose colour is near the given one. */
function countNear(
  img: { width: number; data: Uint8Array },
  box: [number, number, number, number],
  rgb: number[]
) {
  let n = 0
  for (let y = box[1]; y < box[3]; y++)
    for (let x = box[0]; x < box[2]; x++) {
      const p = rgbAt(img, x, y)
      if (p.every((c, i) => Math.abs(c! - rgb[i]!) < 24)) n++
    }
  return n
}

describe('drawShareCard', () => {
  it('is 1200 by 630 on the page colour, with the brand colour along the foot', () => {
    const img = drawShareCard(base)
    expect([img.width, img.height]).toEqual([1200, 630])
    expect(rgbAt(img, 1180, 20)).toEqual([0x0c, 0x86, 0x2c])
    expect(rgbAt(img, 600, 629)).toEqual([0xff, 0xd4, 0x3b])
  })

  it('draws the title and the page name in the text colour', () => {
    const img = drawShareCard(base)
    const titleBand: [number, number, number, number] = [CARD.pad, 300, 1100, 420]
    const pageBand: [number, number, number, number] = [CARD.pad, 430, 1100, 520]
    expect(countNear(img, titleBand, [255, 255, 255])).toBeGreaterThan(500)
    // The page name is softer: the text colour mixed into the page.
    expect(countNear(img, pageBand, [187, 221, 196])).toBeGreaterThan(100)
    expect(countNear(img, pageBand, [255, 255, 255])).toBe(0)
    // Nothing is drawn where there are no words.
    expect(
      countNear(drawShareCard({ ...base, title: '', pageName: null }), titleBand, [255, 255, 255])
    ).toBe(0)
  })

  it('draws the icon where there is one, else a tile in the brand colour', () => {
    const icon = solid(512, [200, 30, 40])
    const withIcon = drawShareCard({ ...base, icon })
    const mid = CARD.pad + CARD.icon / 2
    expect(rgbAt(withIcon, mid, mid)).toEqual([200, 30, 40])
    const tile = drawShareCard(base)
    expect(rgbAt(tile, CARD.pad + 8, mid)).toEqual([0xff, 0xd4, 0x3b])
  })

  it('leaves out a title no bundled face can draw rather than drawing boxes', () => {
    const img = drawShareCard({ ...base, title: '日本語のポータル', pageName: null })
    expect(countNear(img, [CARD.pad, 300, 1100, 420], [255, 255, 255])).toBe(0)
  })
})

describe('encodeShareCard', () => {
  it('is a PNG that decodes to the card', () => {
    const png = encodeShareCard(drawShareCard(base))
    const img = decodePng(png)
    expect([img.width, img.height]).toEqual([1200, 630])
    expect(rgbAt(img, 1180, 20)).toEqual([0x0c, 0x86, 0x2c])
  })
})

describe('drawSquareIcon', () => {
  it('fits a wide icon into a clear square, centred', () => {
    const wide = {
      width: 200,
      height: 100,
      data: solid(200, [10, 20, 30]).data.slice(0, 200 * 100 * 4),
    }
    const square = drawSquareIcon(wide, 64)
    expect([square.width, square.height]).toEqual([64, 64])
    // Clear above and below, the icon in the middle.
    expect(square.data[(2 * 64 + 32) * 4 + 3]).toBe(0)
    expect(rgbAt(square, 32, 32)).toEqual([10, 20, 30])
    expect(square.data[(32 * 64 + 32) * 4 + 3]).toBe(255)
  })
})
