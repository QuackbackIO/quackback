/**
 * A screenshot's page and text colour. The page is the interface's main
 * colour, unless that is the hero's own: a dark poster on a white page (a
 * white header, white below the hero) is a dark hero, so where the header
 * and the page outside the hero agree on another colour, that is the page.
 * The text is the headline's, subtitle's or menu's ink that reads on that
 * page, else the header's.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { fillAndInk, labDist, type Swatch } from './colours'
import type { Box, BoxKind } from './kinds'
import type { Image } from './png'
import { mapColours, mergeColours, regionPalette, type SurfaceMap, type TileKind } from './surfaces'
import { hex } from './color'

/** OKLab distance from the page at which a text colour reads on it. */
const TEXT_ON_PAGE = 0.25
/** Under this share of the screenshot outside the hero, the page is read from the whole screenshot. */
const PAGE_OUTSIDE_MIN = 0.1

const inside = (b: Box, x: number, y: number) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3]

/** Tiles of a map that sit inside a box (by centre). */
export function tileIn(map: SurfaceMap, t: number, b: Box | null | undefined): boolean {
  if (!b) return false
  const tx = t % map.cols
  const ty = (t - tx) / map.cols
  const x = map.box[0] + tx * map.size + map.size / 2
  const y = map.box[1] + ty * map.size + map.size / 2
  return inside(b, x, y)
}

/**
 * The page's colour outside the hero: the most covering interface colour
 * among the tiles outside the hero box (the header and the page below), and
 * the share of the screenshot those tiles cover; null when too little of
 * the page shows outside the hero (a hero filling the screen).
 */
function pageOutside(
  map: SurfaceMap,
  isUi: (t: number, kind: TileKind) => boolean,
  hero: Box
): { colour: Swatch; share: number } | null {
  let n = 0
  const keep = (t: number, kind: TileKind) => {
    const ok = isUi(t, kind) && !tileIn(map, t, hero)
    if (ok) n++
    return ok
  }
  const pal = mapColours(map, keep)
  const share = n / Math.max(1, map.kind.length)
  const colour = pal.colours[0]
  return colour && share >= PAGE_OUTSIDE_MIN ? { colour, share } : null
}

/** The header's own flat colour (not a photo behind it), when one colour fills most of it. */
function headerBand(img: Image, header: Box | null, size: number): Swatch | null {
  if (!header) return null
  const pal = regionPalette(img, header, size)
  const top = pal.colours[0]
  return top && !pal.isPhoto && top.share > 0.5 ? top : null
}

export interface PageRead {
  page: Swatch | null
  /** How much of the screenshot the page was read from, 0.1 to 1: its weight for the site's mode. */
  share: number
}

/** The page: `all` (the interface's main colour) unless the header and the page outside the hero agree on another. */
export function pageOf(
  img: Image,
  map: SurfaceMap,
  isUi: (t: number, kind: TileKind) => boolean,
  all: Swatch | null,
  boxes: Partial<Record<BoxKind, Box | null>>
): PageRead {
  const hero = boxes.hero ?? null
  const outside = hero ? pageOutside(map, isUi, hero) : null
  const header = headerBand(img, boxes.header ?? null, map.size)
  const page =
    all &&
    outside &&
    header &&
    labDist(header.lab, all.lab) > 0.04 &&
    labDist(outside.colour.lab, header.lab) < 0.06
      ? outside.colour
      : all
  return { page, share: outside ? Math.max(PAGE_OUTSIDE_MIN, outside.share) : 1 }
}

/**
 * The type set on the page itself, outside the hero: the ink of the text
 * tiles whose background is the page colour, most covering first, when it
 * reads on the page. A hero picture's inks say nothing about the page's.
 */
export function pageInk(
  map: SurfaceMap,
  isUi: (t: number, kind: TileKind) => boolean,
  page: Swatch | null,
  hero: Box | null
): Swatch | null {
  if (!page) return null
  const items: { lab: number[]; rgb: number[]; w: number }[] = []
  for (let t = 0; t < map.kind.length; t++) {
    if (map.kind[t] !== 1 || !isUi(t, 'text') || tileIn(map, t, hero)) continue
    const main = [map.lab[t * 3]!, map.lab[t * 3 + 1]!, map.lab[t * 3 + 2]!]
    if (labDist(main, page.lab) > 0.06) continue
    items.push({
      lab: [map.inkLab[t * 3]!, map.inkLab[t * 3 + 1]!, map.inkLab[t * 3 + 2]!],
      rgb: [map.inkRgb[t * 3]!, map.inkRgb[t * 3 + 1]!, map.inkRgb[t * 3 + 2]!],
      w: map.ink[t]!,
    })
  }
  const total = items.reduce((sum, it) => sum + it.w, 0)
  const top = mergeColours(items, 0.06).find((g) => labDist(g.lab, page.lab) >= TEXT_ON_PAGE)
  return top
    ? {
        hex: hex(top.rgb),
        rgb: [Math.round(top.rgb[0]!), Math.round(top.rgb[1]!), Math.round(top.rgb[2]!)],
        lab: top.lab,
        share: total ? top.w / total : 0,
      }
    : null
}

/**
 * The text colour: of the inks read (subtitle, headline, menu), the most
 * contrasting that reads on the page; a light headline in a dark hero is
 * not the text of a white page, nor a dark one on a light hero picture the
 * text of a dark page, so then the header's text, else the page's own type.
 */
export function textOf(
  img: Image,
  page: Swatch | null,
  inks: (Swatch | null | undefined)[],
  header: Box | null,
  onPage: Swatch | null = null
): Swatch | null {
  const byContrast = (list: (Swatch | null | undefined)[]) =>
    list
      .filter((x): x is Swatch => !!x)
      .sort((a, b) => (page ? labDist(b.lab, page.lab) - labDist(a.lab, page.lab) : 0))
  const read = byContrast(inks)
  const readsOnPage = (x: Swatch) => !page || labDist(x.lab, page.lab) >= TEXT_ON_PAGE
  return (
    read.find(readsOnPage) ??
    byContrast([fillAndInk(img, header, { mode: 'text' }).ink]).find(readsOnPage) ??
    onPage ??
    read[0] ??
    null
  )
}
