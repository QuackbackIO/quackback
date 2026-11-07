/**
 * A dark photo hero is not a pop-up's dimming. A pop-up's dark layer darkens
 * the whole screen, its edges included (often around a lighter box in the
 * middle); a photo hero is a bounded picture, the page outside it keeping its
 * own light colour to the screen's edges. The finder can read a dark photo
 * hero as dimmed: the pixels settle it. A real layer stays dimmed, whether a
 * modal box shows in it or not, and a builder's warning always holds.
 */
import { describe, expect, it } from 'vitest'
import type { FoundElements } from '../../extract/finder'
import type { FinderOutput } from '../../extract/finder-schema'
import { BOX_KINDS, type Box, type BoxKind } from '../../extract/kinds'
import type { Image } from '../../extract/png'
import { isDimmed, seenDimmed, type Shot } from '../brand-measure'

type Fill = [number, number, number]
const W = 1440
const H = 900

function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** A dark photograph: dim light in many colours, sharp discs, fine grain. */
function darkPhoto(seed = 1) {
  const rnd = random(seed)
  const discs = Array.from({ length: 50 }, () => ({
    x: rnd() * W,
    y: rnd() * H,
    r: 10 + rnd() * 40,
    c: [rnd() * 120, rnd() * 100, rnd() * 90] as Fill,
  }))
  const grain = random(seed + 3)
  return (x: number, y: number): Fill => {
    for (const d of discs) if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r * d.r) return d.c
    const n = (grain() - 0.5) * 8
    return [
      50 + 30 * Math.sin(x / 97 + y / 151) + n,
      45 + 25 * Math.sin(x / 131 - y / 83) + n,
      40 + 30 * Math.cos(x / 173 + y / 59) + n,
    ]
  }
}

function canvas(paint: (x: number, y: number) => Fill): Image {
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) data.set([...paint(x, y), 255], (y * W + x) * 4)
  return { width: W, height: H, data }
}

const inside = (x: number, y: number, b: Box) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3]
const WHITE: Fill = [255, 255, 255]
const INK: Fill = [17, 17, 17]

/** White words, strokes 3px wide every 9px. */
function words(paint: (x: number, y: number) => Fill, b: Box, ink: Fill) {
  return (x: number, y: number): Fill =>
    inside(x, y, b) && (x - b[0]) % 9 < 3 && (y - b[1]) % 40 < 30 ? ink : paint(x, y)
}

const HEADLINE: Box = [420, 230, 1020, 330]

/** A dark photo hero from the top of the screen, under a header of white words, above a white page with dark words. */
function photoHero(): Image {
  const photo = darkPhoto()
  let paint = (x: number, y: number): Fill => (y < 700 ? photo(x, y) : WHITE)
  paint = words(paint, HEADLINE, WHITE)
  paint = words(paint, [48, 26, 600, 54], WHITE)
  paint = words(paint, [96, 760, 900, 860], INK)
  return canvas(paint)
}

/** A white page with dark words, under a pop-up's dark layer (`light` of its light), with or without a modal box. */
function dimmedPage(modal: boolean, light = 0.5): Image {
  const page = words((x, y) => (y < 80 ? [246, 246, 246] : WHITE), [96, 200, 900, 500], INK)
  const box: Box = [470, 260, 970, 640]
  return canvas((x, y) => {
    if (modal && inside(x, y, box)) return inside(x, y, [520, 320, 920, 360]) ? INK : WHITE
    return page(x, y).map((v) => Math.round(v * light)) as Fill
  })
}

function shot(img: Image, boxes: Partial<Record<BoxKind, Box | null>>, dimmed: boolean): Shot {
  const all = Object.fromEntries(BOX_KINDS.map((k) => [k, boxes[k] ?? null])) as Record<
    BoxKind,
    Box | null
  >
  const output = {
    ...(Object.fromEntries(BOX_KINDS.map((k) => [k, 'none'])) as Record<BoxKind, string>),
    headline_text: 'Turn ideas into emails',
    subtitle_text: '',
    logo_text: '',
    primary_button_text: '',
    section_heading_text: '',
    behind_headline_evidence: 'a dark photo of a man at a desk',
    behind_headline: 'photo',
    nav_style: 'plain',
    text_case: 'normal',
    logo_kind: 'wordmark',
    headline_type: 'serif',
    body_type: 'sans',
    cookie_banner: false,
    dimmed,
    main_cta_visible: false,
    product_screenshot_visible: false,
  } as FinderOutput
  const found: FoundElements = { version: 'test', output, scale: 1, boxes: all, snapped: all }
  return { index: 0, img, strip: null, width: W, height: H, found }
}

const HERO_BOXES = {
  header: [0, 0, W, 80] as Box,
  hero: [0, 80, W, 700] as Box,
  headline: HEADLINE,
}

describe('a dark photo hero read as dimmed', () => {
  it('is not dimmed: the page outside the photo keeps its own light colour to the edges', () => {
    const s = shot(photoHero(), HERO_BOXES, true)
    expect(seenDimmed(s)).toBe(false)
  })

  it('still counts as dimmed when the builder warned it was', () => {
    const s = { ...shot(photoHero(), HERO_BOXES, true), told: { dimmed: true } }
    expect(isDimmed(s)).toBe(true)
  })
})

describe('a pop-up’s dark layer', () => {
  it('stays dimmed with a lighter modal box in the middle', () => {
    expect(seenDimmed(shot(dimmedPage(true), { hero: [0, 80, W, 700] }, true))).toBe(true)
  })

  it('stays dimmed with no box showing, as the finder read it', () => {
    expect(seenDimmed(shot(dimmedPage(false, 0.3), { hero: [0, 80, W, 700] }, true))).toBe(true)
  })

  it('is caught by the pixels alone, with a modal box, when the finder misses it', () => {
    expect(seenDimmed(shot(dimmedPage(true), { hero: [0, 80, W, 700] }, false))).toBe(true)
  })
})
