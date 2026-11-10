/**
 * What a screenshot shows behind its content: the page's own colour outside
 * the hero and the cards, how that colour moves down the screenshot (read in
 * horizontal bands), and on a dark page a large soft glow behind the content.
 * The tools measure; decidePageFill (page-fill-decide.ts) turns the readings into
 * a page background.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { hex } from './color'
import { labDist, type Swatch } from './colours'
import type { Box, BoxKind } from './kinds'
import type { Image } from './png'
import { tileIn } from './roles-page'
import { mergeColours, surfaceMap, type SurfaceMap } from './surfaces'

/** How many horizontal bands the page colour is read in, top to bottom. */
export const BANDS = 6
/** A band whose page shows in less than this share of its tiles says nothing. */
const BAND_SEEN = 0.2
/** A band's colour is its page only where one colour holds this share of what shows. */
const BAND_ONE_COLOUR = 0.5
/** Under this share of the screenshot outside the hero, the hero is read as on the page. */
const OUTSIDE_MIN = 0.1
/** The page colour must hold this share of what shows of the page. */
const PAGE_ONE_COLOUR = 0.45
/** Colours this close (OKLab) are one page colour; a slow drift stays within it inside a band. */
const SAME = 0.025
/** Two readings this close (OKLab) are the same page colour. */
const AGREE = 0.02
/** OKLab lightness under which a page is dark, as the roles read it. */
const DARK = 0.4
/** A tile this far from the page (OKLab) is lit by a glow; farther, it is something else. */
const GLOW_FROM = 0.015
const GLOW_TO = 0.3
/** Under a glow, the unlit page holds at least this share of the screenshot's smooth tiles. */
const UNLIT_ONE_COLOUR = 0.25
/** A glow covers at least this share of what shows of the page. */
const GLOW_SHARE = 0.25
/** And is graded: its tiles' distances from the page spread at least this far (a plateau is a section). */
const GLOW_SPREAD = 0.02

export interface PageBand {
  /** The band's middle, as a share of the screenshot's height. */
  at: number
  colour: Swatch
}

export interface PageGlow {
  /** The glow's colour where it is strongest. */
  colour: Swatch
  /** The page it lights, unlit. */
  page: Swatch
  /** Where it is strongest. */
  centre: 'top' | 'middle' | 'corner'
  /** Its share of what shows of the page. */
  share: number
}

export interface PageFillReading {
  /** The page's colour outside the hero and the cards; null when no one colour holds it. */
  page: Swatch | null
  /** The page colour band by band, top first; bands where the page does not show are left out. */
  bands: PageBand[]
  /** A dark page's soft glow behind the content, or null. */
  glow: PageGlow | null
}

const FLAT = 0
const TEXT = 1
const GRADIENT = 2

const swatchOf = (g: { lab: number[]; rgb: number[]; w: number }, total: number): Swatch => ({
  hex: hex(g.rgb as [number, number, number]),
  rgb: [Math.round(g.rgb[0]!), Math.round(g.rgb[1]!), Math.round(g.rgb[2]!)],
  lab: [g.lab[0]!, g.lab[1]!, g.lab[2]!],
  share: total ? g.w / total : 0,
})

const tileLab = (map: SurfaceMap, t: number) => [
  map.lab[t * 3]!,
  map.lab[t * 3 + 1]!,
  map.lab[t * 3 + 2]!,
]
const tileRgb = (map: SurfaceMap, t: number) => [
  map.rgb[t * 3]!,
  map.rgb[t * 3 + 1]!,
  map.rgb[t * 3 + 2]!,
]

/** The one colour holding most of these tiles, with its share; null when none holds `least`. */
function mainColour(map: SurfaceMap, tiles: number[], least: number): Swatch | null {
  if (!tiles.length) return null
  const groups = mergeColours(
    tiles.map((t) => ({ lab: tileLab(map, t), rgb: tileRgb(map, t), w: 1 })),
    SAME
  )
  const top = groups[0]
  return top && top.w / tiles.length >= least ? swatchOf(top, tiles.length) : null
}

/**
 * The page behind a screenshot's content. The page shows where tiles are
 * smooth (flat, text on the page, or a slow gradient), outside the hero, the
 * cards and a product screenshot; when the hero fills the screenshot, the
 * hero is read as sitting on the page. `cards` are any further card boxes.
 */
export function readPageFill(
  img: Image,
  boxes: Partial<Record<BoxKind, Box | null>>,
  cards: readonly Box[] = []
): PageFillReading {
  const u = Math.min(2, Math.max(0.5, img.width / 1440))
  const map = surfaceMap(img, null, Math.max(4, Math.round(8 * u)))
  const n = map.kind.length
  const covers = [boxes.card, boxes.product_screenshot, ...cards].filter((b): b is Box => !!b)
  const smooth = (t: number) =>
    (map.kind[t] === FLAT || map.kind[t] === TEXT || map.kind[t] === GRADIENT) &&
    !covers.some((b) => tileIn(map, t, b))
  const all: number[] = []
  const outside: number[] = []
  const hero: number[] = []
  const header: number[] = []
  for (let t = 0; t < n; t++) {
    if (!smooth(t)) continue
    all.push(t)
    if (tileIn(map, t, boxes.hero)) hero.push(t)
    else outside.push(t)
    if (tileIn(map, t, boxes.header)) header.push(t)
  }
  const page = pageColour(map, { all, outside, hero, header }, n, !!boxes.hero)

  // Band by band, top first, the hero included: a hero on its own surface shows as a step, not a drift.
  const bands: PageBand[] = []
  const perBand = map.rows / BANDS
  for (let b = 0; b < BANDS; b++) {
    const r0 = Math.round(b * perBand)
    const r1 = Math.round((b + 1) * perBand)
    const first = r0 * map.cols
    const last = r1 * map.cols
    const tiles = all.filter((t) => t >= first && t < last)
    if (tiles.length < BAND_SEEN * (last - first)) continue
    const colour = mainColour(map, tiles, BAND_ONE_COLOUR)
    if (colour) bands.push({ at: (r0 + r1) / 2 / Math.max(1, map.rows), colour })
  }

  // Under a glow the page outside the hero is lit too: the unlit page is the screenshot's main colour.
  const unlit = page ?? mainColour(map, all, UNLIT_ONE_COLOUR)
  return { page, bands, glow: unlit && unlit.lab[0]! < DARK ? glowOf(map, all, unlit) : null }
}

/**
 * The page's colour: the one colour outside the hero, where the hero sits on
 * it or the header is in it (else the screenshot shows sections of several
 * colours, as a code host's grey section under its white hero, and no one page
 * colour); the whole screenshot's where the hero fills it.
 */
function pageColour(
  map: SurfaceMap,
  tiles: { all: number[]; outside: number[]; hero: number[]; header: number[] },
  n: number,
  hasHero: boolean
): Swatch | null {
  if (!hasHero || tiles.outside.length < OUTSIDE_MIN * n)
    return mainColour(map, tiles.all, PAGE_ONE_COLOUR)
  const outside = mainColour(map, tiles.outside, PAGE_ONE_COLOUR)
  if (!outside) return null
  const agrees = (s: Swatch | null) => !!s && labDist(s.lab, outside.lab) < AGREE
  return agrees(mainColour(map, tiles.hero, PAGE_ONE_COLOUR)) ||
    agrees(mainColour(map, tiles.header, PAGE_ONE_COLOUR))
    ? outside
    : null
}

/**
 * A dark page's glow: a large share of the page lit a little and graded (its
 * distances from the page spread, as light falls off), not a second flat
 * section. Its colour is where it is strongest, and its centre is there.
 */
function glowOf(map: SurfaceMap, tiles: number[], page: Swatch): PageGlow | null {
  const lit = tiles
    .map((t) => ({ t, d: labDist(tileLab(map, t), page.lab) }))
    .filter((x) => x.d >= GLOW_FROM && x.d < GLOW_TO && map.kind[x.t] !== TEXT)
  if (!tiles.length || lit.length < GLOW_SHARE * tiles.length) return null
  const ds = lit.map((x) => x.d).sort((a, b) => a - b)
  const q = (p: number) => ds[Math.min(ds.length - 1, Math.floor(p * ds.length))]!
  if (q(0.9) - q(0.1) < GLOW_SPREAD) return null
  // Where it is strongest: the brightest tenth.
  const peak = lit.filter((x) => x.d >= q(0.9))
  const groups = mergeColours(
    peak.map((x) => ({ lab: tileLab(map, x.t), rgb: tileRgb(map, x.t), w: 1 })),
    0.08
  )
  const top = groups[0]
  if (!top) return null
  let sx = 0
  let sy = 0
  for (const { t } of peak) {
    sx += (t % map.cols) + 0.5
    sy += Math.floor(t / map.cols) + 0.5
  }
  const x = sx / peak.length / map.cols
  const y = sy / peak.length / map.rows
  const centre = y > 0.35 ? 'middle' : x < 0.25 ? 'corner' : 'top'
  return { colour: swatchOf(top, top.w), page, centre, share: lit.length / tiles.length }
}
