/**
 * The hero's call to action never takes the colour of what it sits on. A
 * brand whose buttons are its navy text colour, with a navy band, would draw
 * a navy button on navy; a second-colour button on a panel of the second
 * colour vanishes the same way. Then the call to action takes the colour
 * that stands out on the band (the brand colour first, else the second),
 * while the other buttons stay as they are.
 */
import { defaultDesign } from '@/lib/shared/design/schema'
import { deltaE00 } from '../extract/color'
import { contrast, hexRgb } from '../extract/roles-places'
import type { BrandChange } from './brand-decide'

/** Closer than this (deltaE00), or under this contrast, a button is the colour it sits on. */
const SAME = 10
const LOST = 1.6
/** What a call to action needs on its band to stand out. */
const STANDS_OUT = 3

const HEX = /^#[\da-f]{6}$/i
const DEFAULT_INK = defaultDesign().brand.light.ink

/** The change that keeps the hero's call to action apart from its band, or null when it already is. */
export function heroActionChange(changes: readonly BrandChange[]): BrandChange | null {
  const at = new Map(changes.map((c) => [c.path, c.value]))
  const hex = (path: string) => {
    const v = at.get(path)
    return typeof v === 'string' && HEX.test(v) ? v : null
  }
  const accent = hex('brand.light.accent')
  if (!accent) return null
  const support = hex('brand.light.support')
  const role = (r: unknown) => (r === 'support' ? support : r === 'extra1' ? null : accent)
  // What the call to action sits on: a panel when the words have one, else the band's colour.
  const band = at.get('layout.band')
  const surface =
    at.get('layout.bandShape') === 'panel'
      ? (support ?? '#ffffff')
      : band === 'support'
        ? support
        : band === 'brand'
          ? role(at.get('layout.bandColour'))
          : null
  if (!surface) return null
  const action = at.get('shape.action')
  const cta =
    action === 'support'
      ? support
      : action === 'accent'
        ? accent
        : (hex('tune.button.fill') ??
          (at.get('shape.fill') === 'ink' ? (hex('brand.light.ink') ?? DEFAULT_INK) : accent))
  if (!cta) return null
  const lost = (a: string) =>
    deltaE00(hexRgb(a), hexRgb(surface)) < SAME || contrast(a, surface) < LOST
  if (!lost(cta)) return null
  const pick = (
    [
      ['accent', accent],
      ['support', support],
    ] as const
  ).find(([, colour]) => colour && contrast(colour, surface) >= STANDS_OUT)
  if (!pick || pick[0] === action) return null
  return {
    path: 'shape.action',
    value: pick[0],
    why: `the hero’s call to action stands out from the band it sits on (${surface}) in the ${pick[0] === 'accent' ? 'brand' : 'second'} colour`,
  }
}
