/**
 * What the browser reads from a screenshot before sending it: a pop-up's
 * dimming layer is told apart, so a clean screenshot can be asked for, and a
 * suggested logo box is fitted to the mark's own pixels.
 */
import { describe, expect, it } from 'vitest'
import { keyOutGround, looksDimmed, snapToMark } from '../brand-shots'

type Rgb = [number, number, number]
const W = 200
const H = 120

function page(background: Rgb = [255, 255, 255]) {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) data.set([...background, 255], i * 4)
  const paint = (
    x0: number,
    y0: number,
    w: number,
    h: number,
    colour: (x: number, y: number) => Rgb
  ) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) data.set([...colour(x, y), 255], (y * W + x) * 4)
  }
  return { data, paint }
}

describe('a screenshot under a pop-up’s dimming layer', () => {
  it('is told apart: one bright panel, nothing near white around it', () => {
    const { data, paint } = page([110, 145, 80])
    paint(40, 60, 120, 40, () => [255, 255, 255])
    expect(looksDimmed(data, W, H)).toBe(true)
  })

  it('is not a light page, a dark site or a page with a white section at its foot', () => {
    expect(looksDimmed(page().data, W, H)).toBe(false)
    const dark = page([8, 9, 10])
    for (let x = 10; x < 190; x += 6) dark.paint(x, 20 + (x % 70), 3, 4, () => [255, 255, 255])
    expect(looksDimmed(dark.data, W, H)).toBe(false)
    const foot = page([159, 232, 112])
    foot.paint(0, 90, 200, 30, () => [255, 255, 255])
    expect(looksDimmed(foot.data, W, H)).toBe(false)
  })
})

describe('the suggested icon box, snapped to the mark', () => {
  // A mark at x 20-39, a gap, then the name's letters from x 46, each 6 wide with 2 between.
  function header() {
    const { data, paint } = page()
    paint(20, 20, 20, 20, () => [255, 56, 92])
    for (let x = 46; x < 100; x += 8) paint(x, 24, 6, 14, () => [34, 34, 34])
    return data
  }
  const px = (box: { x: number; y: number; w: number; h: number }) => ({
    x0: Math.round(box.x * W),
    x1: Math.round((box.x + box.w) * W),
    y0: Math.round(box.y * H),
    y1: Math.round((box.y + box.h) * H),
  })

  it('lets go of a neighbouring letter the box only nicks, and fits the mark with room', () => {
    // The suggested box takes the mark and a sliver of the first letter.
    const box = snapToMark(header(), W, H, { x: 18 / W, y: 18 / H, w: 30 / W, h: 24 / H })
    const at = px(box)
    expect(at.x1).toBeLessThan(46)
    expect(at.x0).toBeLessThan(20)
    expect(at.x0).toBeGreaterThanOrEqual(15)
    expect(at.y0).toBeLessThan(20)
    expect(at.y1).toBeGreaterThan(40)
  })

  it('takes in a letter of a wordmark the box cut through the middle of', () => {
    // A wordmark box ending half way through the last letter (x 94-99).
    const box = snapToMark(header(), W, H, { x: 44 / W, y: 22 / H, w: 53 / W, h: 18 / H })
    expect(px(box).x1).toBeGreaterThanOrEqual(100)
  })

  it('keeps the box when nothing stands out from the page in it', () => {
    const box = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }
    expect(snapToMark(page().data, W, H, box)).toEqual(box)
  })
})

describe('a logo cut from a screenshot, the page around it keyed out', () => {
  const alpha = (data: Uint8ClampedArray, x: number, y: number) => data[(y * W + x) * 4 + 3]
  /** A green "o" (a ring with a counter) and a block with a large white face, on white. */
  function logo(background: Rgb = [255, 255, 255]) {
    const { data, paint } = page(background)
    paint(20, 20, 40, 40, () => [88, 204, 2])
    paint(30, 30, 20, 20, () => background) // a counter: 400 px of a 1600+ px mark, enclosed
    paint(100, 20, 80, 80, () => [88, 204, 2])
    paint(110, 30, 60, 60, () => [255, 255, 255]) // an inner face: 3600 px, kept
    return data
  }

  it('clears the page and a letter’s counter, keeping the ink and a large inner face', () => {
    const data = logo()
    expect(keyOutGround(data, W, H)).toBe(true)
    expect(alpha(data, 2, 2)).toBe(0) // the page
    expect(alpha(data, 90, 60)).toBe(0) // between the marks
    expect(alpha(data, 25, 25)).toBe(255) // the ink
    expect(alpha(data, 40, 40)).toBe(0) // the counter
    expect(alpha(data, 140, 60)).toBe(255) // the inner face
    expect([...data.slice((60 * W + 140) * 4, (60 * W + 140) * 4 + 3)]).toEqual([255, 255, 255])
  })

  it('keys out a page of any uniform colour, give or take its compression noise', () => {
    const { data, paint } = page([246, 244, 238])
    paint(0, 0, W, H, (x, y) => [246 + ((x + y) % 3) - 1, 244, 238 - ((x * y) % 3)])
    paint(60, 40, 40, 40, () => [20, 20, 20])
    expect(keyOutGround(data, W, H)).toBe(true)
    expect(alpha(data, 5, 5)).toBe(0)
    expect(alpha(data, 80, 60)).toBe(255)
  })

  it('fades the anti-aliased rim, with the page’s colour taken out of it', () => {
    const { data, paint } = page()
    paint(60, 40, 40, 40, () => [0, 0, 0])
    paint(59, 40, 1, 40, () => [128, 128, 128]) // half the ink over white
    keyOutGround(data, W, H)
    const p = (60 * W + 59) * 4
    expect(data[p + 3]).toBeGreaterThan(64)
    expect(data[p + 3]).toBeLessThan(255)
    // Unblended toward the ink, not left grey-white.
    expect(data[p]!).toBeLessThan(60)
  })

  it('leaves a crop whose edge is not one colour as it was', () => {
    const { data, paint } = page()
    paint(0, 0, W / 2, H, () => [10, 80, 200]) // half the edge is a photo's blue
    paint(120, 40, 20, 20, () => [0, 0, 0])
    const before = data.slice()
    expect(keyOutGround(data, W, H)).toBe(false)
    expect(data).toEqual(before)
  })
})
