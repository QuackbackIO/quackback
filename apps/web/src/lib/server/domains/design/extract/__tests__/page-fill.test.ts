/**
 * Page backgrounds from measurement, on synthetic screenshots with known
 * answers: a white page, a cream page with white cards, a near-white page, a
 * page drifting from pale blue to white, a dark page lit by a soft glow, a
 * photo hero on white, a white hero over a grey section (Forgeline's), and a
 * saturated green page (Fernway's band read as the page).
 */
import { describe, expect, it } from 'vitest'
import type { Box, BoxKind } from '../kinds'
import { readPageFill, type PageBand } from '../page-fill'
import { decidePageFill, driftOf, sitePageFill, type PageFillSite } from '../page-fill-decide'
import type { Image } from '../png'
import { oklab } from '../color'

type Fill = [number, number, number]
const W = 1440
const H = 900

function canvas(bg: Fill): Image {
  const data = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4)
  return { width: W, height: H, data }
}
function rect(img: Image, [x0, y0, x1, y1]: Box, c: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}
/** Each pixel painted by a function of its place. */
function paint(img: Image, [x0, y0, x1, y1]: Box, at: (x: number, y: number) => Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([...at(x, y), 255], (y * img.width + x) * 4)
}
const mix = (a: Fill, b: Fill, t: number): Fill =>
  [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Fill
/** Lines of text: thin strokes of ink. */
function text(img: Image, [x0, y0, x1, y1]: Box, ink: Fill) {
  for (let y = y0; y + 2 < y1; y += 14)
    for (let x = x0; x + 3 < x1; x += 7) {
      if (Math.floor((x - x0) / 42) % 5 === 4) continue
      rect(img, [x, y, x + 2, y + 9], ink)
    }
}
/** A busy photo: seeded noise around a colour. */
function photo(img: Image, box: Box, base: Fill) {
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
  paint(img, box, () => base.map((v) => Math.max(0, Math.min(255, v + rnd() * 90))) as Fill)
}

const INK: Fill = [17, 17, 17]
const LIGHT_SITE: PageFillSite = { scheme: 'light', text: '#111111' }
const DARK_SITE: PageFillSite = { scheme: 'dark', text: '#f2f2f2' }

const HEADER: Box = [0, 0, W, 72]
const HERO: Box = [0, 72, W, 560]
const HEADLINE: Box = [200, 200, 1000, 300]
const CARDS: Box[] = [
  [120, 620, 480, 840],
  [540, 620, 900, 840],
  [960, 620, 1320, 840],
]

/** A landing page: a header, a hero with a headline, and three cards below, on `page`. */
function landing(page: Fill, card: Fill = [255, 255, 255]): Image {
  const img = canvas(page)
  text(img, [80, 30, 600, 44], INK)
  text(img, HEADLINE, INK)
  for (const c of CARDS) {
    rect(img, c, card)
    text(img, [c[0] + 24, c[1] + 24, c[2] - 24, c[1] + 80], INK)
  }
  return img
}
const boxes = (more: Partial<Record<BoxKind, Box | null>> = {}) => ({
  header: HEADER,
  hero: HERO,
  headline: HEADLINE,
  card: CARDS[0],
  ...more,
})

describe('page backgrounds from measurement', () => {
  it('leaves a white page solid', () => {
    const reading = readPageFill(landing([255, 255, 255]), boxes(), CARDS)
    expect(reading.page?.hex).toBe('#ffffff')
    expect(decidePageFill(reading, LIGHT_SITE)).toBeNull()
  })

  it('leaves a near-white page solid', () => {
    for (const grey of [253, 250] as const) {
      const reading = readPageFill(landing([grey, grey, grey]), boxes(), CARDS)
      expect(decidePageFill(reading, LIGHT_SITE)).toBeNull()
    }
  })

  it('tints a cream page with white cards in its exact colour', () => {
    const reading = readPageFill(landing([247, 243, 234]), boxes(), CARDS)
    const decided = decidePageFill(reading, LIGHT_SITE)
    expect(decided?.background).toEqual({ kind: 'tint', colour: '#f7f3ea' })
    expect(decided?.look).toBe('tint')
    expect(decided?.mode).toBe('light')
    expect(decided?.why).toContain('#f7f3ea')
  })

  it('tints a grey-blue page, the cards left out of the reading', () => {
    // The cards cover much of what shows outside the hero; the page is still read around them.
    const reading = readPageFill(landing([238, 242, 248]), boxes(), CARDS)
    expect(decidePageFill(reading, LIGHT_SITE)?.background).toEqual({
      kind: 'tint',
      colour: '#eef2f8',
    })
  })

  it('sets a gradient where the page drifts from pale blue at the top to white', () => {
    const top: Fill = [214, 228, 255]
    const img = canvas([255, 255, 255])
    paint(img, [0, 0, W, H], (_, y) => mix(top, [255, 255, 255], y / (H - 1)))
    text(img, HEADLINE, INK)
    for (const c of CARDS) rect(img, c, [255, 255, 255])
    const reading = readPageFill(img, boxes(), CARDS)
    const decided = decidePageFill(reading, LIGHT_SITE)
    expect(decided?.look).toBe('drift')
    const bg = decided?.background as { kind: string; stops: string[]; direction: string }
    expect(bg.kind).toBe('gradient')
    expect(bg.direction).toBe('down')
    // Exact measured colours, top first: bluish at the top, near white at the bottom.
    const first = oklab(rgbOf(bg.stops[0]!))
    const last = oklab(rgbOf(bg.stops.at(-1)!))
    expect(first[0]).toBeLessThan(last[0])
    expect(Math.hypot(first[1], first[2])).toBeGreaterThan(0.02)
    expect(bg.stops.length).toBeLessThanOrEqual(3)
  })

  it('reads a dark page lit by a soft glow as a radial glow in dark mode only', () => {
    const page: Fill = [10, 10, 20]
    const glow: Fill = [58, 40, 110]
    const img = canvas(page)
    // A soft glow centred above the top middle, fading to the page by two thirds down.
    paint(img, [0, 0, W, H], (x, y) => {
      const r = Math.hypot((x - W / 2) / (W * 0.55), y / (H * 0.75))
      return mix(glow, page, Math.min(1, r))
    })
    text(img, HEADLINE, [242, 242, 242])
    const reading = readPageFill(img, boxes({ hero: [0, 72, W, 560] }), [])
    expect(reading.glow?.centre).toBe('top')
    const decided = decidePageFill(reading, DARK_SITE)
    expect(decided?.look).toBe('glow')
    expect(decided?.mode).toBe('dark')
    expect(decided?.background).toMatchObject({
      kind: 'solid',
      dark: { kind: 'gradient', shape: 'radial', centre: 'top' },
    })
    const dark = (decided!.background as { dark: { stops: string[] } }).dark
    expect(dark.stops[1]).toBe('page')
    expect(dark.stops[0]).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('leaves a flat dark page to dark mode’s own page colour', () => {
    const img = canvas([18, 18, 24])
    text(img, HEADLINE, [242, 242, 242])
    expect(decidePageFill(readPageFill(img, boxes(), []), DARK_SITE)).toBeNull()
  })

  it('reads a dark page with a flat section of another dark colour as no glow', () => {
    const img = canvas([10, 10, 20])
    rect(img, [0, 300, W, 700], [30, 36, 60])
    text(img, HEADLINE, [242, 242, 242])
    const reading = readPageFill(img, boxes({ card: null }), [])
    expect(reading.glow).toBeNull()
    expect(decidePageFill(reading, DARK_SITE)).toBeNull()
  })

  it('leaves a photo hero on a white page solid', () => {
    const img = landing([255, 255, 255])
    photo(img, HERO, [120, 90, 70])
    const reading = readPageFill(img, boxes(), CARDS)
    expect(reading.page?.hex).toBe('#ffffff')
    expect(decidePageFill(reading, LIGHT_SITE)).toBeNull()
  })

  it('leaves a white hero over a grey section solid: sections, not a page colour', () => {
    const img = canvas([255, 255, 255])
    rect(img, [0, 520, W, H], [241, 244, 242])
    text(img, HEADLINE, INK)
    const reading = readPageFill(img, boxes({ hero: [0, 72, W, 520], card: null }), [])
    expect(reading.page).toBeNull()
    expect(decidePageFill(reading, LIGHT_SITE)).toBeNull()
  })

  it('leaves a saturated page solid: a band of the brand colour, not a page', () => {
    const reading = readPageFill(landing([159, 232, 112]), boxes(), CARDS)
    expect(reading.page?.hex).toBe('#9fe870')
    expect(decidePageFill(reading, { scheme: 'light', text: '#163300' })).toBeNull()
  })

  it('never proposes a page the text does not read on', () => {
    const reading = readPageFill(landing([214, 210, 200]), boxes(), CARDS)
    // #d6d2c8 is light and quiet, but grey text does not read on it at 4.5:1.
    expect(decidePageFill(reading, { scheme: 'light', text: '#777777' })).toBeNull()
    expect(decidePageFill(reading, LIGHT_SITE)?.background).toEqual({
      kind: 'tint',
      colour: '#d6d2c8',
    })
  })
})

const band = (at: number, rgb: Fill): PageBand => {
  const lab = oklab(rgb)
  return { at, colour: { hex: '#000000', rgb, lab: [...lab], share: 1 } }
}

describe('driftOf', () => {
  it('reads a steady drift over the bands', () => {
    const bands = [0, 1, 2, 3, 4, 5].map((i) =>
      band((i + 0.5) / 6, mix([214, 228, 255], [255, 255, 255], i / 5))
    )
    expect(driftOf(bands)?.stops).toHaveLength(2)
  })

  it('reads one step as a section, not a drift', () => {
    const bands = [0, 1, 2, 3, 4, 5].map((i) =>
      band((i + 0.5) / 6, i < 3 ? [255, 255, 255] : [235, 238, 245])
    )
    expect(driftOf(bands)).toBeNull()
  })

  it('reads a change too small to see as flat', () => {
    const bands = [0, 1, 2, 3, 4, 5].map((i) =>
      band((i + 0.5) / 6, mix([250, 250, 252], [255, 255, 255], i / 5))
    )
    expect(driftOf(bands)).toBeNull()
  })

  it('needs bands over half the screenshot', () => {
    const bands = [0, 1, 2].map((i) =>
      band((i + 0.5) / 6, mix([214, 228, 255], [255, 255, 255], i / 2))
    )
    expect(driftOf(bands)).toBeNull()
  })
})

describe('sitePageFill', () => {
  it('keeps the first screenshot’s background where the others agree, else none', () => {
    const cream = readPageFill(landing([247, 243, 234]), boxes(), CARDS)
    const white = readPageFill(landing([255, 255, 255]), boxes(), CARDS)
    expect(sitePageFill([cream, cream], LIGHT_SITE)?.look).toBe('tint')
    expect(sitePageFill([cream, white], LIGHT_SITE)).toBeNull()
    expect(sitePageFill([], LIGHT_SITE)).toBeNull()
  })
})

function rgbOf(hex: string): Fill {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Fill
}
