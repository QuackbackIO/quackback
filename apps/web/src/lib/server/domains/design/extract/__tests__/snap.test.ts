/**
 * Box snapping on synthetic images: a loose box shrinks to a filled
 * rectangle, a tight one grows to it, a busy background only ever shrinks,
 * text lines join, and a header region runs full width to its edge.
 */
import { describe, expect, it } from 'vitest'
import type { Box } from '../kinds'
import type { Image } from '../png'
import { frameStats, iou, scaleOf, shrinkToInk, snapBox } from '../snap'

type Fill = [number, number, number]

function canvas(width: number, height: number, bg: Fill | ((x: number, y: number) => Fill)): Image {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = typeof bg === 'function' ? bg(x, y) : bg
      data.set([c[0], c[1], c[2], 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

function rect(img: Image, [x0, y0, x1, y1]: Box, c: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}

const WHITE: Fill = [255, 255, 255]
const BLUE: Fill = [0, 88, 163]
const BUTTON: Box = [100, 50, 220, 90]

describe('snapping', () => {
  it('shrinks a loose box to a filled rectangle', () => {
    const img = canvas(400, 200, WHITE)
    rect(img, BUTTON, BLUE)
    expect(snapBox(img, 'primary_button', [88, 42, 236, 100])).toEqual(BUTTON)
  })

  it('grows a slightly tight box to the rectangle', () => {
    const img = canvas(400, 200, WHITE)
    rect(img, BUTTON, BLUE)
    expect(snapBox(img, 'primary_button', [104, 53, 215, 87])).toEqual(BUTTON)
  })

  it('on a busy background only shrinks', () => {
    // Hashed noise: no colour holds half the frame, so the background is busy.
    const noise = (x: number, y: number): Fill => {
      let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
      h = Math.imul(h ^ (h >>> 13), 1274126177)
      const v = (h ^ (h >>> 16)) & 255
      return [v, (v * 3) % 256, (v * 7) % 256]
    }
    const img = canvas(400, 200, noise)
    rect(img, BUTTON, BLUE)
    const loose: Box = [90, 44, 232, 98]
    const out = snapBox(img, 'primary_button', loose)!
    expect(frameStats(img, loose).share).toBeLessThan(0.5)
    expect(out[0]).toBeGreaterThanOrEqual(loose[0])
    expect(out[1]).toBeGreaterThanOrEqual(loose[1])
    expect(out[2]).toBeLessThanOrEqual(loose[2])
    expect(out[3]).toBeLessThanOrEqual(loose[3])
    // A tight box that grows to the button on a plain page stays put here.
    expect(snapBox(img, 'primary_button', [104, 53, 215, 87])).toEqual([104, 53, 215, 87])
  })

  it('joins the lines of a headline', () => {
    const img = canvas(600, 300, WHITE)
    // Two lines of "text" with a 10px leading gap.
    rect(img, [100, 100, 420, 130], [17, 17, 17])
    rect(img, [100, 140, 360, 170], [17, 17, 17])
    expect(snapBox(img, 'headline', [94, 92, 432, 178])).toEqual([100, 100, 420, 170])
  })

  it('runs a header full width to its bottom edge, within a pixel', () => {
    const img = canvas(1440, 900, WHITE)
    rect(img, [0, 0, 1440, 72], [24, 24, 24])
    const out = snapBox(img, 'header', [8, 0, 1432, 64])!
    expect(out.slice(0, 3)).toEqual([0, 0, 1440])
    expect(Math.abs(out[3] - 72)).toBeLessThanOrEqual(1)
  })

  it('keeps the box when there is nothing to snap to', () => {
    const img = canvas(400, 200, WHITE)
    expect(snapBox(img, 'primary_button', BUTTON)).toEqual(BUTTON)
    expect(snapBox(img, 'logo', null)).toBeNull()
  })

  it('shrinks a box to the ink inside it, never past it', () => {
    const img = canvas(400, 200, WHITE)
    rect(img, BUTTON, BLUE)
    expect(shrinkToInk(img, [60, 20, 300, 150])).toEqual(BUTTON)
    expect(shrinkToInk(img, [120, 60, 200, 80])).toEqual([120, 60, 200, 80])
  })

  it('scores overlap and guesses retina from width', () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1)
    expect(iou([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(1 / 3)
    expect(iou(null, [0, 0, 1, 1])).toBe(0)
    expect(scaleOf({ width: 2880 })).toBe(2)
    expect(scaleOf({ width: 1440 })).toBe(1)
  })
})
