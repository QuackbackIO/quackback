/**
 * The site's scheme from the whole screenshot's pixels, with no element
 * boxes: how much of the interface (photos left out) is dark or light, which
 * way its type runs (light on dark, or dark on light), and the colour at the
 * top of the page, where the header shows the page's own colour.
 *
 * The finder's boxes move from one answer to the next (a headline box or
 * none, a hero box with or without the header), and the page and text read
 * through them move with them: a dark site whose only text read was a thin
 * grey menu label read as light. The pixels do not move, so where they are
 * clear they settle the scheme; where they are not (a dark hero block on a
 * white page, a photo, a mid-tone gradient), they leave it to the reading
 * through the boxes.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { hex } from './color'
import type { Swatch } from './colours'
import { DARK_PAGE } from './roles-tones'
import { mergeColours, TILE_KINDS, type SurfaceMap } from './surfaces'

const TEXT = TILE_KINDS.indexOf('text')
const PHOTO = TILE_KINDS.indexOf('photo')

/** OKLab lightness over which a tile is a light surface (white, paper, pale grey). */
export const LIGHT_TONE = 0.8
/**
 * The share of the interface (and of its top) one tone must hold to settle
 * the scheme. Dark sites' first screens measure 0.85 and more; a dark hero
 * block on a white page 0.6 to 0.76, with a light top; light sites 0.8 and
 * more light, or a coloured hero that leaves it to the boxes.
 */
export const SETTLED = 0.8
/** The top of the page (its header) is this share of the rows. */
const TOP = 0.12
/** Type reads on a surface this much lighter or darker than it. */
const TYPE_APART = 0.25

export interface PageTones {
  /** The scheme the pixels settle, or null where they leave it open. */
  scheme: 'light' | 'dark' | null
  /** Shares of the interface tiles (photos left out) that are dark and light. */
  dark: number
  light: number
  /** The most covering surface colour of the settled tone, or null. */
  page: Swatch | null
  /** The most covering ink of the type set on that tone, or null. */
  text: Swatch | null
}

type Item = { lab: number[]; rgb: number[]; w: number }

const swatch = (items: Item[]): Swatch | null => {
  const total = items.reduce((s, x) => s + x.w, 0)
  const top = mergeColours(items, 0.06)[0]
  if (!top) return null
  const rgb = top.rgb.map(Math.round) as [number, number, number]
  return {
    hex: hex(rgb),
    rgb,
    lab: top.lab as [number, number, number],
    share: total ? top.w / total : 0,
  }
}

/** The scheme a screenshot's pixels settle, read over its whole surface map. */
export function pageTones(map: SurfaceMap): PageTones {
  const rows = map.rows
  let n = 0
  let dark = 0
  let light = 0
  let top = 0
  let topDark = 0
  let topLight = 0
  const darkSurface: Item[] = []
  const lightSurface: Item[] = []
  const lightType: Item[] = []
  const darkType: Item[] = []
  for (let t = 0; t < map.kind.length; t++) {
    if (map.kind[t] === PHOTO) continue
    n++
    const lab = [map.lab[t * 3]!, map.lab[t * 3 + 1]!, map.lab[t * 3 + 2]!]
    const rgb = [map.rgb[t * 3]!, map.rgb[t * 3 + 1]!, map.rgb[t * 3 + 2]!]
    const L = lab[0]!
    const isDark = L < DARK_PAGE
    const isLight = L > LIGHT_TONE
    if (isDark) {
      dark++
      darkSurface.push({ lab, rgb, w: 1 })
    } else if (isLight) {
      light++
      lightSurface.push({ lab, rgb, w: 1 })
    }
    if (Math.floor(t / map.cols) < rows * TOP) {
      top++
      if (isDark) topDark++
      else if (isLight) topLight++
    }
    if (map.kind[t] !== TEXT) continue
    const ink = {
      lab: [map.inkLab[t * 3]!, map.inkLab[t * 3 + 1]!, map.inkLab[t * 3 + 2]!],
      rgb: [map.inkRgb[t * 3]!, map.inkRgb[t * 3 + 1]!, map.inkRgb[t * 3 + 2]!],
      w: map.ink[t]!,
    }
    if (isDark && ink.lab[0]! > L + TYPE_APART) lightType.push(ink)
    else if (isLight && ink.lab[0]! < L - TYPE_APART) darkType.push(ink)
  }
  const out: PageTones = {
    scheme: null,
    dark: n ? dark / n : 0,
    light: n ? light / n : 0,
    page: null,
    text: null,
  }
  if (!n || !top) return out
  if (out.dark >= SETTLED && topDark / top >= SETTLED && lightType.length > darkType.length)
    return { ...out, scheme: 'dark', page: swatch(darkSurface), text: swatch(lightType) }
  if (out.light >= SETTLED && topLight / top >= SETTLED && darkType.length > lightType.length)
    return { ...out, scheme: 'light', page: swatch(lightSurface), text: swatch(darkType) }
  return out
}
