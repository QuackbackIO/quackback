/**
 * The page background a brand match sets, from what readPageFill measured:
 *
 * - a gradient where the page colour drifts down the screenshot (several
 *   bands, the change spread over them, never one step: a step is a section
 *   of another colour), its stops the measured colours, top first;
 * - on a dark site, a radial glow where a large soft glow lights the page
 *   behind the content, from the glow's colour to the page;
 * - a tint of the measured colour where the page is quiet, light and
 *   measurably not white (a cream, beige or grey-blue page; cards often stay
 *   white);
 * - else nothing: the page's own colour, as before.
 *
 * Never an image (a site's imagery is never copied) and never a pattern.
 * Every colour proposed reads at 4.5:1 with the site's text, though the
 * renderer softens anyway. A dark site's portal is dark, and its measured
 * page is dark mode's: its background goes in the `dark` field, light mode
 * staying solid; a dark site's flat page needs no tint, as dark mode's page
 * colour is already the measured one.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { chromaOf, labDist, type Swatch } from './colours'
import type { PageBand, PageFillReading } from './page-fill'
import { contrast } from './roles-places'

/** Under this OKLab distance from white a page is white (#fafafa, #fdfdfd): no tint. */
export const NEAR_WHITE = 0.02
/** A light page is at least this light (OKLab) ... */
const LIGHT_PAGE = 0.8
/** ... and this quiet (OKLab chroma): a saturated colour is a band or a hero, not a page. */
export const QUIET = 0.06
/** A gradient's stops may be a little more colourful than a flat page. */
const QUIET_GRADIENT = 0.08
/** Text on the page reads at this contrast on every colour proposed. */
export const PAGE_TEXT = 4.5
/** A drift this large (OKLab, top to bottom) is measurable. */
export const DRIFT_MIN = 0.025
/** No step between bands holds more than this share of the drift (one big step is a section's edge). */
const STEP_MOST = 0.5
/** A step this share of the drift or more counts as part of it; a drift needs three. */
const STEP_PART = 0.1
/** A drift reads over at least this share of the screenshot's height. */
const DRIFT_SPAN = 0.5
/** A middle band this far (OKLab) off the line between the ends is a third stop. */
const BEND = 0.015
/** A gradient's ends this close to the page colour are written as the page's own. */
const AT_PAGE = 0.02
/** A gradient's strength by how far its stops step from the page (the renderer's depths). */
const DEPTHS = [
  ['faint', 0.05],
  ['soft', 0.09],
  ['strong', 0.15],
] as const

type Strength = (typeof DEPTHS)[number][0]
/** A colour a fill names: an exact one, or the page's own. */
type FillColour = string

export type PageFillFill =
  | { kind: 'tint'; colour: FillColour }
  | {
      kind: 'gradient'
      stops: FillColour[]
      shape?: 'radial'
      direction?: 'down'
      centre?: 'top' | 'middle' | 'corner'
      strength?: Strength
    }

/** The site's background as the design keeps it (layout.background). */
export type PageFillBackground = PageFillFill | { kind: 'solid'; dark: PageFillFill }

export interface PageFillDecision {
  background: PageFillBackground
  /** What it looks like: a flat tint, a drift down the page, or a glow. */
  look: 'tint' | 'drift' | 'glow'
  /** The mode that shows it. */
  mode: 'light' | 'dark'
  /** The measured colours, as hex: the tint; the top and bottom (and a middle); the glow and the page. */
  colours: string[]
  /** The evidence, as a reply says it. */
  why: string
}

export interface PageFillSite {
  scheme: 'light' | 'dark'
  /** The site's text colour, hex. */
  text: string
}

const WHITE = [1, 0, 0]
const reads = (hex: string, text: string) => contrast(hex, text) >= PAGE_TEXT
const lightPage = (s: Swatch, quiet: number) => s.lab[0]! >= LIGHT_PAGE && chromaOf(s.lab) <= quiet

/**
 * The drift down a page, when its bands show one: three bands or more over
 * half the screenshot, moving away from the top band step by step (never
 * back), with no step holding most of the change. Null for a flat page or a
 * page of sections.
 */
export function driftOf(bands: readonly PageBand[]): { stops: Swatch[]; size: number } | null {
  if (bands.length < 3) return null
  const first = bands[0]!
  const last = bands.at(-1)!
  if (last.at - first.at < DRIFT_SPAN) return null
  const size = labDist(first.colour.lab, last.colour.lab)
  if (size < DRIFT_MIN) return null
  const steps = bands.slice(1).map((b, i) => labDist(bands[i]!.colour.lab, b.colour.lab))
  if (Math.max(...steps) > STEP_MOST * size) return null
  if (steps.filter((s) => s >= STEP_PART * size).length < 3) return null
  // Away from the top all the way down.
  const away = bands.map((b) => labDist(first.colour.lab, b.colour.lab))
  if (away.some((d, i) => i > 0 && d < away[i - 1]! - BEND)) return null
  // A middle band off the straight line is a third stop.
  const bend = bands.slice(1, -1).reduce<{ band: PageBand; off: number } | null>((most, band) => {
    const t = (band.at - first.at) / (last.at - first.at)
    const line = first.colour.lab.map((v, q) => v + (last.colour.lab[q]! - v) * t)
    const off = labDist(band.colour.lab, line)
    return !most || off > most.off ? { band, off } : most
  }, null)
  const stops = [first.colour, ...(bend && bend.off > BEND ? [bend.band.colour] : []), last.colour]
  return { stops, size }
}

/** The renderer's strength nearest a measured step from the page. */
function strengthOf(step: number): Strength | undefined {
  const near = DEPTHS.reduce((a, b) => (Math.abs(b[1] - step) < Math.abs(a[1] - step) ? b : a))
  return near[0] === 'faint' ? undefined : near[0]
}

/** One screenshot's page background, or null for its page's own colour. */
export function decidePageFill(
  reading: PageFillReading,
  site: PageFillSite
): PageFillDecision | null {
  return site.scheme === 'dark' ? darkFill(reading, site) : lightFill(reading, site)
}

function lightFill(reading: PageFillReading, site: PageFillSite): PageFillDecision | null {
  const drift = driftOf(reading.bands)
  if (
    drift &&
    drift.stops.every((s) => lightPage(s, QUIET_GRADIENT) && reads(s.hex, site.text)) &&
    drift.stops.some((s) => labDist(s.lab, WHITE) >= NEAR_WHITE)
  ) {
    const colours = drift.stops.map((s) => s.hex)
    return {
      background: { kind: 'gradient', stops: colours, direction: 'down' },
      look: 'drift',
      mode: 'light',
      colours,
      why: `the page colour drifts from ${colours[0]} at the top to ${colours.at(-1)} at the bottom`,
    }
  }
  const page = reading.page
  if (
    page &&
    lightPage(page, QUIET) &&
    labDist(page.lab, WHITE) >= NEAR_WHITE &&
    reads(page.hex, site.text)
  )
    return {
      background: { kind: 'tint', colour: page.hex },
      look: 'tint',
      mode: 'light',
      colours: [page.hex],
      why: `the page colour outside the hero and the cards, ${page.hex}, is not white`,
    }
  return null
}

function darkFill(reading: PageFillReading, site: PageFillSite): PageFillDecision | null {
  const page = reading.page ?? reading.glow?.page
  if (!page) return null
  // The stop at the page is the page's own, so dark mode draws it as dark mode's page.
  const stop = (s: Swatch) => (labDist(s.lab, page.lab) < AT_PAGE ? 'page' : s.hex)
  const dark = (fill: PageFillFill) => ({ kind: 'solid' as const, dark: fill })
  const glow = reading.glow
  if (glow && reads(glow.colour.hex, site.text)) {
    const strength = strengthOf(Math.abs(glow.colour.lab[0]! - page.lab[0]!))
    return {
      background: dark({
        kind: 'gradient',
        shape: 'radial',
        centre: glow.centre,
        stops: [glow.colour.hex, 'page'],
        ...(strength ? { strength } : {}),
      }),
      look: 'glow',
      mode: 'dark',
      colours: [glow.colour.hex, page.hex],
      why: `a soft glow of ${glow.colour.hex} over the ${page.hex} page, strongest at the ${glow.centre === 'middle' ? 'middle' : glow.centre === 'corner' ? 'top corner' : 'top'}`,
    }
  }
  const drift = driftOf(reading.bands)
  if (drift && drift.stops.every((s) => s.lab[0]! < LIGHT_PAGE && reads(s.hex, site.text))) {
    const stops = drift.stops.map(stop)
    const step = Math.max(...drift.stops.map((s) => Math.abs(s.lab[0]! - page.lab[0]!)))
    const strength = strengthOf(step)
    const colours = drift.stops.map((s) => s.hex)
    return {
      background: dark({
        kind: 'gradient',
        stops,
        direction: 'down',
        ...(strength ? { strength } : {}),
      }),
      look: 'drift',
      mode: 'dark',
      colours,
      why: `the page colour drifts from ${colours[0]} at the top to ${colours.at(-1)} at the bottom`,
    }
  }
  return null
}

/**
 * The site's page background from every clean screenshot: the first's (the
 * screenshot type and shape are read from), kept only where the others agree
 * on its look; screenshots that disagree leave the page its own colour.
 */
export function sitePageFill(
  readings: readonly PageFillReading[],
  site: PageFillSite
): PageFillDecision | null {
  const [first, ...rest] = readings.map((r) => decidePageFill(r, site))
  if (!first) return null
  return rest.every((d) => d?.look === first.look) ? first : null
}
