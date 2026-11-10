/**
 * How a band ends where the page begins. A band of a colour far from the
 * page's (lime or orange on white) ends on a clean edge, as a site's coloured
 * section does. A band near the page's colour, or of its hue (a blue band on a
 * darker blue page, navy on near black), reads as cut off by a hard edge, so
 * it fades into the page instead; so do bands of glows, gradients or art.
 * Pure: the server's resolver and the builder's preview draw the same CSS.
 */
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { normaliseColor } from './color'
import { contrastRatio } from './contrast'

/** OKLab distance under which two colours are near enough that an edge between them reads as a seam. */
export const NEAR = 0.15
/** Hue difference, in degrees, within which two coloured surfaces are one family. */
export const SAME_HUE = 35
/** Chroma over which a colour has a hue at all (greys and near blacks have none). */
const HUED = 0.03

/** A glow band's foot fades over its last 8rem, or less than half of a short band. */
export const GLOW_FOOT_FROM = 'max(55%, calc(100% - 8rem))'
/** A glow band fades in under a header in the page's colour over its first 4rem. */
export const GLOW_HEAD = '4rem'
/** A coloured band whose words read on the page too fades over its last 6rem. */
export const SOFT_FOOT_FROM = 'max(55%, calc(100% - 6rem))'

/**
 * How a band ends, as tokens the band draws: a fade painted over its foot in
 * the page's colour (`paint`); the page's colour faded in over its bottom
 * padding alone (`pad`), so no word ever sits where the band turns into the
 * page; and, over a page of more than one colour, the band itself fading out
 * over that padding (`fadeOut`). The padding (--qb-band-pad) is the band's
 * own, so the band composes those two from the colours given here.
 */
export interface BandFoot {
  paint: string
  pad: string
  fadeOut: boolean
}

/** A band that ends on its own clean edge. */
export const CLEAN_EDGE: BandFoot = { paint: 'none', pad: 'transparent', fadeOut: false }

function oklch(colour: string) {
  const known = normaliseColor(colour)
  if (!known) return null
  return parseOklch(known.startsWith('#') ? hexToOklch(known) : known)
}

function lab(colour: string): [number, number, number] | null {
  const p = oklch(colour)
  if (!p) return null
  const rad = (p.h * Math.PI) / 180
  return [p.l, p.c * Math.cos(rad), p.c * Math.sin(rad)]
}

/** OKLab distance between two colours (0 the same, about 1 black to white). */
export function oklabDistance(a: string, b: string): number {
  const [x, y] = [lab(a), lab(b)]
  if (!x || !y) return Infinity
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/** Whether two colours are both coloured and of one hue family. */
export function sameHue(a: string, b: string): boolean {
  const [x, y] = [oklch(a), oklch(b)]
  if (!x || !y || x.c < HUED || y.c < HUED) return false
  const apart = Math.abs(x.h - y.h) % 360
  return Math.min(apart, 360 - apart) <= SAME_HUE
}

/** Whether a band of these colours, on this page, should fade into it rather than end on an edge. */
export function fadesIntoPage(band: string[], page: string): boolean {
  return band.some((colour) => oklabDistance(colour, page) < NEAR || sameHue(colour, page))
}

/**
 * The foot of a coloured band fading into the page: over its last 6rem where
 * its words read on the page as well, else only over its bottom padding.
 */
export function softFoot(page: string, inks: string[]): BandFoot {
  const reads = inks.every((ink) => contrastRatio(ink, page) >= 4.5)
  return reads
    ? { ...CLEAN_EDGE, paint: `linear-gradient(to bottom, transparent ${SOFT_FOOT_FROM}, ${page})` }
    : { ...CLEAN_EDGE, pad: page }
}

/**
 * The foot of a band of glows on the page's colour: fading back into the page
 * before the band ends and, under a header that does not share the band, in
 * from the page at its top, so the glows are never cut flat at either edge.
 */
export function glowFoot(page: string, head: boolean): string {
  return head
    ? `linear-gradient(to bottom, ${page}, transparent ${GLOW_HEAD}, transparent ${GLOW_FOOT_FROM}, ${page})`
    : `linear-gradient(to bottom, transparent ${GLOW_FOOT_FROM}, ${page})`
}
