/**
 * The site's scheme (a dark page with light text, or a light one) and what
 * its buttons are filled with in it: dark buttons are text-coloured on a
 * light site, light ones on a dark site. Also when two colours are shades of
 * one.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { deltaE00, oklab, type RGB } from './color'
import { chromaOf, labDist } from './colours'
import { hexRgb } from './roles-places'
import {
  DARK_PAGE,
  isLightNeutral,
  LIGHT_TEXT,
  NEUTRAL,
  type ColourEvidence,
} from './roles-evidence'
import type { ActionRole } from './roles'

export const hexLab = (h: string): RGB => oklab(hexRgb(h))

/**
 * Under a pop-up's layer a white page reads as dark as OKLab 0.45 (X0's
 * veiled captures, extract/undim.ts) and a heavy layer darker still: only a
 * page darker than this is a dark site's.
 */
const DIMMED_DARK_PAGE = 0.3
/** OKLab distance under which a text colour does not read on its page. */
const TEXT_ON_DARK = 0.25
/**
 * Type this much lighter than a dark page (OKLab lightness) is light type on
 * it, white or not: a grey caption or a search field's placeholder on a
 * near-black page is a dark site's text.
 */
const LIGHTER_THAN_PAGE = 0.4

export const isLightNeutralHex = (h: string) => isLightNeutral({ lab: hexLab(h) })

/** Hue angle in OKLab, degrees. */
const hueOf = (lab: readonly number[]) =>
  ((Math.atan2(lab[2]!, lab[1]!) * 180) / Math.PI + 360) % 360

/** Two shades of one colour (a logo's pink and a button's deeper pink), not two colours. */
export function sameColour(a: string, b: string): boolean {
  const x = hexLab(a)
  const y = hexLab(b)
  if (deltaE00(hexRgb(a), hexRgb(b)) < 10) return true
  const dh = Math.abs(hueOf(x) - hueOf(y))
  const cx = chromaOf(x)
  const cy = chromaOf(y)
  // Same hue, as colourful, a little lighter or darker; a deep aubergine beside a bright purple is a second colour.
  return (
    Math.min(cx, cy) > 0.08 &&
    Math.min(cx, cy) >= 0.75 * Math.max(cx, cy) &&
    Math.min(dh, 360 - dh) < 12 &&
    Math.abs(x[0] - y[0]) < 0.15
  )
}

/**
 * The site's scheme, from each screenshot's page and text: a screenshot
 * whose whole pixels settle it (page-tones.ts) votes that way with all of it;
 * otherwise dark when the
 * screenshots' dark pages with light (or unread, or unreadable) text outweigh the light
 * ones, each weighed by how much page it shows outside its hero. A dark
 * hero block on a white page reads its page outside the hero, so it is a
 * dark hero, not a dark site.
 */
export function siteScheme(ev: ColourEvidence): 'light' | 'dark' {
  const shots = ev.shots.length
    ? ev.shots.map((s) => ({
        page: s.page?.lab ?? null,
        text: s.text?.lab ?? null,
        // Settled by the whole screenshot's pixels: all of it counts.
        weight: s.settled ? 1 : (s.pageShare ?? 1),
        dimmed: !!s.dimmed,
        settled: s.settled ?? null,
      }))
    : [{ page: hexLab(ev.page), text: hexLab(ev.ink), weight: 1, dimmed: false, settled: null }]
  // A screenshot still under a pop-up's layer only counts when nothing else shows the page.
  const lit = shots.filter((s) => s.page && !s.dimmed)
  const read = lit.length ? lit : shots.filter((s) => s.page)
  if (!read.length) return 'light'
  const total = read.reduce((sum, s) => sum + s.weight, 0)
  const dark = read
    // A text that does not read on its dark page (a dark ink taken off a light hero picture) is unread.
    .filter((s) =>
      s.settled
        ? s.settled === 'dark'
        : s.page![0] < (s.dimmed ? DIMMED_DARK_PAGE : DARK_PAGE) &&
          (!s.text ||
            s.text[0] > LIGHT_TEXT ||
            s.text[0] - s.page![0] >= LIGHTER_THAN_PAGE ||
            labDist(s.text, s.page!) < TEXT_ON_DARK)
    )
    .reduce((sum, s) => sum + s.weight, 0)
  return dark * 2 > total ? 'dark' : 'light'
}

/** A button the colour of text: dark on a light site, light on a dark one. */
export function inkButton(lab: RGB, scheme: 'light' | 'dark'): boolean {
  if (chromaOf(lab) >= NEUTRAL + 0.01) return false
  return scheme === 'dark' ? lab[0] > 0.8 : lab[0] < 0.45
}

/** The role of the site's main button fill, measured; null without one to read. */
export function siteButtons(
  fill: string | null,
  inverted: boolean,
  /** Whether the fill is a shade of the brand colour. */
  isIdentity: boolean,
  scheme: 'light' | 'dark',
  monochrome: boolean
): ActionRole | null {
  if (!fill || inverted) return null
  const lab = hexLab(fill)
  if (scheme === 'light' && isLightNeutralHex(fill)) return null
  if (inkButton(lab, scheme)) return 'ink'
  if (isIdentity) return monochrome ? 'ink' : 'accent'
  return chromaOf(lab) < NEUTRAL ? 'neutral' : 'support'
}
