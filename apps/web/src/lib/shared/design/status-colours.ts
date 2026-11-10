/**
 * Status colours in a brand's own colours: each status takes the brand
 * colour nearest its hue, when that is close to its own, so a status page
 * keeps telling statuses apart in the colours of a multi-colour logo. A
 * status no brand colour is close to keeps its own, so two statuses do not
 * share one colour. Greys stay grey.
 */
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { solveContrast } from './contrast'

const oklch = (colour: string) => parseOklch(colour.startsWith('#') ? hexToOklch(colour) : colour)

/** Below this chroma a colour reads as grey and has no hue worth matching. */
const GREY = 0.03

/** How far apart two hues can be, in degrees, and still read as the same colour. */
const NEAR = 45

const hueGap = (a: number, b: number) => {
  const gap = Math.abs(a - b) % 360
  return gap > 180 ? 360 - gap : gap
}

/** The brand colour nearest a status colour's hue, or the status colour itself. */
export function brandStatusColour(status: string, brand: readonly string[]): string {
  const own = oklch(status)
  if (!own || own.c < GREY || brand.length === 0) return status
  let nearest = status
  let best = Infinity
  for (const colour of brand) {
    const candidate = oklch(colour)
    if (!candidate || candidate.c < GREY) continue
    const gap = hueGap(own.h, candidate.h)
    if (gap < best) [best, nearest] = [gap, colour]
  }
  return best <= NEAR ? nearest : status
}

/** What a status marker needs against what it sits on to be seen. */
const MARKER_CONTRAST = 3

/**
 * Brand colours as status markers draw them: each moved in lightness, keeping
 * its hue, until it reaches 3:1 on every background it sits on.
 */
export function readableStatusColours(
  colours: readonly string[],
  backgrounds: readonly string[]
): string[] {
  return colours.map((colour) => solveContrast(colour, [...backgrounds], MARKER_CONTRAST) ?? colour)
}
