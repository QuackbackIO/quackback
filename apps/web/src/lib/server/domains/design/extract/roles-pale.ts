/**
 * A pale tint (a hero's peach, a gradient's light stop) is not a brand's
 * identity where its logo, a button or a link carries a saturated colour:
 * that colour is the brand's, the tint at most its second. Nor is any colour
 * seen only inside a gradient, however light: gradient stops feed the hero's
 * blend, never the identity, while a button or logo shows one.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { deltaE00 } from './color'
import { chromaOf } from './colours'
import { hexRgb } from './roles-places'
import type { Candidate, Source } from './roles-evidence'
import { hexLab } from './roles-scheme'

/** Very light and soft (OKLab): a tint. */
const PALE_LIGHTNESS = 0.85
const PALE_CHROMA = 0.1
/** Chroma (OKLab) from which a logo, button or link colour is saturated. */
const VIVID_CHROMA = 0.1
const VIVID_PLACES: Source[] = [
  'logo',
  'logo_field',
  'button',
  'header_button',
  'link',
  'active_nav',
]

export const isPaleTint = (lab: readonly number[]) =>
  lab[0]! >= PALE_LIGHTNESS && chromaOf(lab) < PALE_CHROMA

const GRADIENT_PLACES: Source[] = ['hero_gradient', 'gradient', 'product']

/** Seen only as a stop of a gradient (or in a product picture): never the identity on its own. */
export const onlyInGradients = (c: Candidate | undefined) =>
  !!c && c.sightings.length > 0 && c.sightings.every((s) => GRADIENT_PLACES.includes(s.source))

/** The strongest saturated logo, button or link colour to take over a pale or gradient-only identity, or null. */
export function vividOverPale(
  rank: readonly { c: Candidate }[],
  identity: string
): Candidate | null {
  const own = rank.find(({ c }) => deltaE00(c.rgb, hexRgb(identity)) < 7)?.c
  if (!isPaleTint(hexLab(identity)) && !onlyInGradients(own)) return null
  const vivid = rank.find(
    ({ c }) =>
      c.chroma >= VIVID_CHROMA &&
      c.lightness >= 0.3 &&
      c.lightness <= 0.8 &&
      c.sightings.some((s) => VIVID_PLACES.includes(s.source))
  )
  return vivid?.c ?? null
}
