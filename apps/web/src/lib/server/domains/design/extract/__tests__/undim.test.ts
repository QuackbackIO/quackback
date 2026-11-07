/**
 * A screenshot under a pop-up's dark layer, lifted back: a white page with a
 * navy header and hero, a bright blue button and black text, veiled by
 * rgba(26, 26, 26, 0.6) everywhere but a white pop-up. Its colours come back
 * within a just-visible difference, so the navy and the blue are read as
 * the site's, not as a dull navy for both; pages with no layer stay as they are.
 */
import { describe, expect, it } from 'vitest'
import { logoChanges } from '../../ai/brand-decide'
import { cutBrandLogo, measureColours, type Shot } from '../../ai/brand-measure'
import type { FoundElements } from '../finder'
import { deltaE00, parseColor, type RGB } from '../color'
import type { Box, BoxKind } from '../kinds'
import type { Image } from '../png'
import { colourEvidence, decideRoles } from '../roles'
import { undimmed, veilOf } from '../undim'

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
function text(img: Image, [x0, y0, x1, y1]: Box, ink: Fill) {
  for (let x = x0; x + 3 < x1; x += 6) {
    if (Math.floor((x - x0) / 36) % 4 === 3) continue
    rect(img, [x + 1, y0, x + 3, y1], ink)
  }
}
/** The layer over everything but the pop-up. */
function veil(img: Image, colour: Fill, alpha: number, keep: Box) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x >= keep[0] && x < keep[2] && y >= keep[1] && y < keep[3]) continue
      const o = (y * W + x) * 4
      for (let c = 0; c < 3; c++)
        img.data[o + c] = Math.round(img.data[o + c]! * (1 - alpha) + colour[c]! * alpha)
    }
}
const px = (img: Image, x: number, y: number): RGB => {
  const o = (y * img.width + x) * 4
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
}
const near = (hex: string | null | undefined, c: Fill, de: number) => {
  expect(hex).toBeTruthy()
  expect(deltaE00(parseColor(hex!) as RGB, c)).toBeLessThan(de)
}

const WHITE: Fill = [255, 255, 255]
const NAVY: Fill = [0, 59, 149]
const BLUE: Fill = [0, 108, 228]
const BLACK: Fill = [26, 26, 26]
const POPUP: Box = [320, 200, 640, 400]

const BOXES: Partial<Record<BoxKind, Box | null>> = {
  header: [0, 0, W, 64],
  logo: [32, 20, 112, 44],
  nav_row: [400, 26, 600, 38],
  hero: [0, 64, W, 260],
  headline: [64, 110, 520, 150],
  subtitle: [64, 170, 400, 182],
  primary_button: [780, 220, 900, 256],
}

/** A white page with a navy header and hero, a blue search button and black text. */
function site(): Image {
  const img = canvas(WHITE)
  rect(img, [0, 0, W, 260], NAVY)
  rect(img, [32, 20, 112, 44], WHITE)
  text(img, [400, 26, 600, 38], WHITE)
  text(img, [64, 110, 520, 150], WHITE)
  text(img, [64, 170, 400, 182], WHITE)
  rect(img, [780, 220, 900, 256], BLUE)
  text(img, [800, 232, 880, 244], WHITE)
  text(img, [64, 300, 300, 330], BLACK)
  text(img, [64, 360, 900, 372], BLACK)
  text(img, [64, 420, 900, 432], BLACK)
  text(img, [64, 480, 700, 492], BLACK)
  return img
}

function veiled(): Image {
  const img = site()
  rect(img, POPUP, WHITE)
  text(img, [360, 260, 600, 280], BLACK)
  rect(img, [360, 330, 600, 370], BLUE)
  veil(img, [26, 26, 26], 0.6, POPUP)
  return img
}

describe('a screenshot under a pop-up’s dark layer', () => {
  it('reads the layer from the page: how much shows through and the layer’s level', () => {
    const v = veilOf(veiled())
    expect(v).not.toBeNull()
    expect(v!.keep).toBeCloseTo(0.4, 1)
    expect(v!.offset).toBeGreaterThan(10)
    expect(v!.offset).toBeLessThan(22)
  })

  it('lifts the page’s colours back, and leaves the pop-up as it is', () => {
    const img = undimmed(veiled())
    expect(deltaE00(px(img, 10, 100), NAVY)).toBeLessThan(3)
    expect(deltaE00(px(img, 790, 222), BLUE)).toBeLessThan(3)
    expect(deltaE00(px(img, 10, 560), WHITE)).toBeLessThan(2)
    expect(deltaE00(px(img, 370, 340), BLUE)).toBeLessThan(1)
  })

  it('reads the navy and the blue as two colours once lifted', () => {
    const ev = colourEvidence([{ img: undimmed(veiled()), boxes: BOXES, behind: 'solid_colour' }])
    near(ev.shots[0]!.mainButton?.hex, BLUE, 4)
    const roles = decideRoles(ev)
    near(roles.identity.value, NAVY, 5)
    expect(roles.scheme).toBe('light')
  })

  it('leaves a screenshot with no layer as it is', () => {
    const img = site()
    expect(veilOf(img)).toBeNull()
    expect(undimmed(img)).toBe(img)
  })

  it('leaves a dark page as it is', () => {
    const img = canvas([12, 12, 14])
    text(img, [64, 110, 520, 150], [240, 240, 240])
    expect(veilOf(img)).toBeNull()
  })
})

describe('measuring colours from a screenshot under a pop-up', () => {
  const asShot = (img: Image, dimmed: boolean): Shot => ({
    index: 0,
    img,
    strip: null,
    width: img.width,
    height: img.height,
    found: {
      version: 'test',
      scale: 1,
      boxes: BOXES,
      snapped: BOXES,
      output: { dimmed, cookie_banner: false, behind_headline: 'solid_colour' },
    } as unknown as FoundElements,
  })

  it('lifts the screenshot the finder saw dimmed before reading its colours', () => {
    const { roles, evidence } = measureColours([asShot(veiled(), true)])
    near(roles.identity.value, NAVY, 5)
    near(evidence.shots[0]!.mainButton?.hex, BLUE, 4)
  })

  it('lifts it too where the finder missed the layer but its pixels show it', () => {
    const { roles } = measureColours([asShot(veiled(), false)])
    near(roles.identity.value, NAVY, 5)
  })

  it('leaves a screenshot with no layer as it is', () => {
    const { roles } = measureColours([asShot(site(), true)])
    near(roles.identity.value, NAVY, 3)
  })
})

describe('the logo cut from a screenshot under a pop-up', () => {
  const asShot = (img: Image): Shot => ({
    index: 0,
    img,
    strip: null,
    width: img.width,
    height: img.height,
    found: {
      version: 'test',
      scale: 1,
      boxes: BOXES,
      snapped: BOXES,
      output: { dimmed: true, cookie_banner: false, logo_kind: 'wordmark' },
    } as unknown as FoundElements,
  })

  it('is lifted too: a white logo stays white, one ink, and needs no tile on its navy header', () => {
    const logo = cutBrandLogo([asShot(veiled())])!
    expect(logo.tone).toBe('light')
    expect(logo.oneInk).toBe(true)
    const paths = logoChanges(logo, 'header-logos/a.png', null).map((c) => [c.path, c.value])
    expect(paths).toContainEqual(['brand.logo.tone', 'light'])
    expect(paths).toContainEqual(['brand.logo.oneInk', true])
    // Its one ink's colour, so a header of that colour draws it in its text.
    const ink = paths.find(([p]) => p === 'brand.logo.ink')?.[1] as string
    expect(ink).toMatch(/^#[0-9a-f]{6}$/)
    near(ink, [255, 255, 255], 4)
  })
})
