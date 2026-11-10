/**
 * The site's scheme from the whole screenshot's pixels (page-tones.ts): a
 * dark site stays dark whatever boxes the finder draws (a headline box or
 * none, a menu box over thin grey labels), and a white page with one dark
 * hero block is not settled by the pixels (the boxes read it as a light site
 * with a dark hero, roles-mode.test.ts).
 */
import { describe, expect, it } from 'vitest'
import type { Box, BoxKind } from '../kinds'
import type { Image } from '../png'
import { colourEvidence, decideRoles } from '../roles'
import { pageTones } from '../page-tones'
import { surfaceMap } from '../surfaces'

type Fill = [number, number, number]
const W = 960
const H = 600

function canvas(bg: Fill): Image {
  const data = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4)
  return { width: W, height: H, data }
}
function rect(img: Image, [x0, y0, x1, y1]: Box, c: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}
const mixC = (a: Fill, b: Fill, t: number): Fill =>
  [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Fill
function text(img: Image, [x0, y0, x1, y1]: Box, ink: Fill, under: Fill) {
  for (let x = x0; x + 3 < x1; x += 6) {
    if (Math.floor((x - x0) / 36) % 4 === 3) continue
    rect(img, [x, y0, x + 1, y1], mixC(under, ink, 0.4))
    rect(img, [x + 1, y0, x + 3, y1], ink)
    rect(img, [x + 3, y0, x + 4, y1], mixC(under, ink, 0.6))
  }
}

const BLACK: Fill = [0, 0, 0]
const WHITE: Fill = [255, 255, 255]
const GREY_LABEL: Fill = [109, 109, 109]
const INK: Fill = [17, 17, 17]
const POSTER: Fill = [22, 22, 22]

const HEADER: Box = [0, 0, W, 64]
const HERO: Box = [0, 64, W, H]
const NAV: Box = [300, 33, 700, 49]

/** A dark site: white logo, a menu of white words over thin grey sub-labels, white type on black. */
function darkSite(): Image {
  const img = canvas(BLACK)
  rect(img, [32, 20, 112, 44], WHITE)
  text(img, [300, 16, 700, 28], WHITE, BLACK)
  text(img, [300, 34, 700, 48], GREY_LABEL, BLACK)
  text(img, [64, 140, 620, 190], WHITE, BLACK)
  text(img, [64, 210, 460, 222], WHITE, BLACK)
  text(img, [64, 480, 500, 500], WHITE, BLACK)
  text(img, [64, 530, 700, 540], WHITE, BLACK)
  return img
}

/** A white page with one dark poster for its hero, white below. */
function darkHeroOnWhite(): Image {
  const img = canvas(WHITE)
  rect(img, [0, 64, W, 440], POSTER)
  rect(img, [32, 20, 112, 44], INK)
  text(img, [400, 26, 600, 38], INK, WHITE)
  text(img, [64, 140, 620, 190], WHITE, POSTER)
  text(img, [64, 480, 500, 500], INK, WHITE)
  text(img, [64, 530, 700, 540], INK, WHITE)
  return img
}

/** What the finder may draw on the dark site from one answer to the next. */
const READS: Record<string, Partial<Record<BoxKind, Box | null>>> = {
  'headline and subtitle': {
    header: HEADER,
    hero: HERO,
    nav_row: [300, 16, 700, 28],
    headline: [64, 140, 620, 190],
    subtitle: [64, 210, 460, 222],
  },
  'only the menu, over its grey labels': { header: HEADER, hero: HERO, nav_row: NAV },
  'the hero taking the header in': { header: HEADER, hero: [0, 0, W, H], nav_row: NAV },
  'no boxes': {},
}

describe('pageTones', () => {
  it('settles a dark site dark, with its dark page and light type', () => {
    const img = darkSite()
    const t = pageTones(surfaceMap(img, null, 8))
    expect(t.scheme).toBe('dark')
    expect(t.page!.lab[0]).toBeLessThan(0.1)
    expect(t.text!.lab[0]).toBeGreaterThan(0.7)
  })

  it('leaves a white page with a dark hero block to the boxes', () => {
    expect(pageTones(surfaceMap(darkHeroOnWhite(), null, 8)).scheme).toBeNull()
  })

  it('settles a plain white site light', () => {
    const img = canvas(WHITE)
    text(img, [400, 26, 600, 38], INK, WHITE)
    text(img, [64, 140, 620, 190], INK, WHITE)
    text(img, [64, 480, 500, 500], INK, WHITE)
    expect(pageTones(surfaceMap(img, null, 8)).scheme).toBe('light')
  })
})

describe('the site scheme does not hinge on the boxes', () => {
  for (const [name, boxes] of Object.entries(READS))
    it(`a dark site is dark, with light text, when the finder drew ${name}`, () => {
      const roles = decideRoles(colourEvidence([{ img: darkSite(), boxes }]))
      expect(roles.scheme).toBe('dark')
      expect(roles.page).toBe('#000000')
      expect(parseInt(roles.text.slice(1, 3), 16)).toBeGreaterThan(200)
    })

  it('a screenshot still under a pop-up layer is not settled by its dark pixels', () => {
    const ev = colourEvidence([{ img: darkHeroOnWhite(), boxes: { header: HEADER } }])
    expect(ev.shots[0]!.settled).toBeUndefined()
    const dim = colourEvidence([{ img: darkSite(), boxes: READS['no boxes']!, dimmed: true }])
    expect(dim.shots[0]!.settled).toBeUndefined()
  })
})
