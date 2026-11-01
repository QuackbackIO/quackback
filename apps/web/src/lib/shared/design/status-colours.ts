/**
 * Status colours in a brand's own colours: each status takes the brand
 * colour nearest its hue, so a status page keeps telling statuses apart in
 * the colours of a multi-colour logo. Greys stay grey.
 */
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'

const oklch = (colour: string) => parseOklch(colour.startsWith('#') ? hexToOklch(colour) : colour)

/** Below this chroma a colour reads as grey and has no hue worth matching. */
const GREY = 0.03

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
  return nearest
}
