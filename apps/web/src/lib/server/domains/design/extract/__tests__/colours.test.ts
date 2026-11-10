/**
 * Colour tools on synthetic images with known answers: a button's fill and
 * label through anti-aliased edges, heavy type in a tight box, a two-colour
 * logo, photo and gradient regions flagged and kept out of a palette, and
 * badges found on a busy photo.
 */
import { describe, expect, it } from 'vitest'
import { deltaE00, type RGB } from '../color'
import { boxColours, fillAndInk } from '../colours'
import { solidShapes } from '../shapes'
import { regionPalette, surfaceMap } from '../surfaces'
import type { Box } from '../kinds'
import { iou } from '../snap'
import type { Image } from '../png'

type Fill = [number, number, number]

function canvas(width: number, height: number, bg: Fill | ((x: number, y: number) => Fill)): Image {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = typeof bg === 'function' ? bg(x, y) : bg
      data.set([c[0], c[1], c[2], 255], (y * width + x) * 4)
    }
  return { width, height, data }
}

function rect(img: Image, [x0, y0, x1, y1]: Box, c: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}

const mixC = (a: Fill, b: Fill, t: number): Fill => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]

/** Vertical strokes 2px wide with a blended pixel either side, as anti-aliased type draws. */
function strokes(img: Image, [x0, y0, x1, y1]: Box, ink: Fill, under: Fill, gap = 6) {
  for (let x = x0; x + 3 < x1; x += gap) {
    rect(img, [x, y0, x + 1, y1], mixC(under, ink, 0.4))
    rect(img, [x + 1, y0, x + 3, y1], ink)
    rect(img, [x + 3, y0, x + 4, y1], mixC(under, ink, 0.6))
  }
}

/** Hashed noise in many colours: a photo's texture. */
const noise = (x: number, y: number): Fill => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return [h & 255, (h >>> 8) & 255, (h >>> 16) & 255]
}

const WHITE: Fill = [255, 255, 255]
const BLUE: Fill = [0, 88, 163]
const YELLOW: Fill = [255, 219, 0]
const INK: Fill = [17, 17, 17]
const near = (a: RGB | undefined, b: RGB, de = 2) => {
  expect(a).toBeDefined()
  expect(deltaE00(a!, b)).toBeLessThan(de)
}

describe('fillAndInk', () => {
  it('reads a button fill and its label through anti-aliased edges', () => {
    const img = canvas(300, 120, WHITE)
    rect(img, [40, 30, 240, 78], BLUE)
    strokes(img, [80, 44, 200, 64], WHITE, BLUE)
    const r = fillAndInk(img, [40, 30, 240, 78])
    near(r.fill?.rgb, BLUE)
    near(r.ink?.rgb, WHITE)
    expect(r.contrast).toBeGreaterThan(0.3)
  })

  it('ignores the page showing at rounded corners', () => {
    const img = canvas(300, 120, WHITE)
    rect(img, [40, 30, 240, 78], YELLOW)
    // Corners: page colour in 10px squares.
    for (const [x, y] of [
      [40, 30],
      [230, 30],
      [40, 68],
      [230, 68],
    ] as const)
      rect(img, [x, y, x + 10, y + 10], WHITE)
    strokes(img, [80, 44, 200, 64], INK, YELLOW)
    const r = fillAndInk(img, [40, 30, 240, 78])
    near(r.fill?.rgb, YELLOW)
    near(r.ink?.rgb, INK)
  })

  it('reads the label of a pill on a photo, not the photo at its ends', () => {
    // A dark photo (wood, a shadow): darker than the label, so its pixels would contrast most.
    const img = canvas(300, 120, (x, y) =>
      mixC([20, 8, 2], [60, 30, 12], ((x * 7 + y * 13) % 17) / 40)
    )
    const NAVY: Fill = [9, 23, 35]
    // A white pill: the box's ends show the photo behind it.
    for (let y = 30; y < 78; y++)
      for (let x = 40; x < 240; x++) {
        const dx = x < 64 ? 64 - x : x > 216 ? x - 216 : 0
        if (dx * dx + (y - 54) ** 2 <= 24 * 24) img.data.set([...WHITE, 255], (y * 300 + x) * 4)
      }
    strokes(img, [80, 46, 200, 62], NAVY, WHITE)
    const r = fillAndInk(img, [40, 30, 240, 78])
    near(r.fill?.rgb, WHITE)
    near(r.ink?.rgb, NAVY, 3)
  })

  it('takes the frame colour as the fill of heavy type in a tight box', () => {
    const img = canvas(300, 120, WHITE)
    // Heavy strokes cover about two thirds of the text box.
    for (let x = 50; x < 250; x += 6) rect(img, [x, 40, x + 4, 80], INK)
    const r = fillAndInk(img, [50, 40, 250, 80], { mode: 'text' })
    near(r.fill?.rgb, WHITE)
    near(r.ink?.rgb, INK)
  })

  it('has no ink for a plain box', () => {
    const img = canvas(100, 100, BLUE)
    const r = fillAndInk(img, [10, 10, 90, 90])
    near(r.fill?.rgb, BLUE)
    expect(r.ink).toBeNull()
  })

  it('is empty for a missing box', () => {
    expect(fillAndInk(canvas(10, 10, WHITE), null)).toEqual({ fill: null, ink: null, contrast: 0 })
  })
})

describe('boxColours', () => {
  it('reads a two-colour logo over the page with shares', () => {
    const img = canvas(200, 100, WHITE)
    rect(img, [40, 30, 140, 70], BLUE)
    // Yellow lettering inside the blue box.
    for (let x = 50; x < 130; x += 8) rect(img, [x, 40, x + 4, 60], YELLOW)
    const r = boxColours(img, [40, 30, 140, 70])
    near(r.background?.rgb, WHITE)
    expect(r.colours.map((c) => c.hex)).toHaveLength(2)
    near(r.colours[0]?.rgb, BLUE)
    near(r.colours[1]?.rgb, YELLOW)
    expect(r.colours[0]!.share).toBeGreaterThan(r.colours[1]!.share)
  })
})

describe('regionPalette', () => {
  it('reads a flat region as its one colour', () => {
    const img = canvas(160, 160, BLUE)
    const r = regionPalette(img, [0, 0, 160, 160])
    expect(r.isPhoto).toBe(false)
    expect(r.isGradient).toBe(false)
    near(r.colours[0]?.rgb, BLUE)
    expect(r.colours[0]!.share).toBeGreaterThan(0.95)
  })

  it('flags a photo and keeps its colours out', () => {
    const img = canvas(160, 160, noise)
    const r = regionPalette(img, [0, 0, 160, 160])
    expect(r.isPhoto).toBe(true)
    expect(r.colours.reduce((t, c) => t + c.share, 0)).toBeLessThan(0.1)
  })

  it('flags a smooth gradient and keeps its colours out', () => {
    const img = canvas(320, 160, (x) => mixC([83, 58, 253], [255, 122, 89], x / 319))
    const r = regionPalette(img, [0, 0, 320, 160])
    expect(r.isGradient).toBe(true)
    expect(r.colours.reduce((t, c) => t + c.share, 0)).toBeLessThan(0.15)
    expect(r.gradientColours.length).toBeGreaterThan(1)
  })

  it('counts a UI with text and leaves an inset photo out', () => {
    const img = canvas(320, 240, WHITE)
    rect(img, [0, 0, 320, 48], BLUE)
    strokes(img, [20, 100, 140, 116], INK, WHITE)
    for (let y = 120; y < 232; y++)
      for (let x = 168; x < 312; x++) img.data.set([...noise(x, y), 255], (y * 320 + x) * 4)
    const r = regionPalette(img, [0, 0, 320, 240])
    const white = r.colours.find((c) => deltaE00(c.rgb, WHITE) < 2)
    const blue = r.colours.find((c) => deltaE00(c.rgb, BLUE) < 2)
    expect(white && blue).toBeTruthy()
    expect(blue!.share).toBeGreaterThan(0.15)
    expect(r.photo).toBeGreaterThan(0.15)
    expect(r.isPhoto).toBe(false)
    // Nothing else of any size: the photo's colours are not in the palette.
    expect(r.colours.filter((c) => c.share > 0.01).length).toBeLessThanOrEqual(3)
  })

  it('marks text tiles with their ink', () => {
    const img = canvas(64, 32, WHITE)
    strokes(img, [0, 0, 64, 32], INK, WHITE)
    const map = surfaceMap(img, [0, 0, 64, 32])
    expect([...map.kind].every((k) => k === 1)).toBe(true)
  })
})

describe('solidShapes', () => {
  it('finds a labelled badge on a photo and a button on the page, not a plain disc', () => {
    const img = canvas(400, 200, WHITE)
    for (let y = 0; y < 120; y++)
      for (let x = 0; x < 200; x++) img.data.set([...noise(x, y), 255], (y * 400 + x) * 4)
    rect(img, [20, 20, 80, 42], [204, 0, 8])
    strokes(img, [28, 26, 72, 36], WHITE, [204, 0, 8])
    rect(img, [240, 140, 380, 184], BLUE)
    strokes(img, [260, 152, 360, 172], WHITE, BLUE)
    // A plain disc: no label.
    for (let y = 130; y < 170; y++)
      for (let x = 20; x < 60; x++)
        if ((x - 40) ** 2 + (y - 150) ** 2 < 400) img.data.set([0, 160, 80, 255], (y * 400 + x) * 4)
    const shapes = solidShapes(img)
    const badge = shapes.find((s) => deltaE00(s.fill.rgb, [204, 0, 8]) < 2)
    const button = shapes.find((s) => deltaE00(s.fill.rgb, BLUE) < 2)
    expect(iou(badge?.box, [20, 20, 80, 42])).toBeGreaterThan(0.9)
    near(badge?.ink?.rgb, WHITE, 5)
    expect(iou(button?.box, [240, 140, 380, 184])).toBeGreaterThan(0.95)
    expect(shapes.find((s) => deltaE00(s.fill.rgb, [0, 160, 80]) < 2)).toBeUndefined()
  })
})
