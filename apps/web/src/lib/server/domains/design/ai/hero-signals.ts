/**
 * What the hero rules read beyond the colour measures (heroSignals): a brand
 * colour filling a large section, a second colour used as a field, and an
 * inset hero.
 */
import { oklab } from '../extract/color'
import type { Box } from '../extract/kinds'
import type { ColourEvidence, ColourRoles } from '../extract/roles'
import { hexRgb } from '../extract/roles-places'
import type { HeroEvidence } from './hero-family'

const lightness = (hex: string) => oklab(hexRgb(hex))[0]
const near = (a: string, b: string) =>
  Math.hypot(...oklab(hexRgb(a)).map((v, i) => v - oklab(hexRgb(b))[i]!)) < 0.05

/** A screenshot's hero box, for whether the hero is set in. */
export interface HeroGeometry {
  width: number
  hero: Box | null
}

/** Places where a colour is a filled field rather than ink or an accent. */
const FIELD_SOURCES = new Set(['logo', 'logo_field', 'badge', 'card', 'surface', 'header_band'])
const SECTION_SOURCES = new Set(['surface', 'header_band', 'hero_surface', 'card'])

/**
 * What the hero rules read beyond the colour measures: a brand colour that
 * fills a large section of the first screen, a second colour used as a filled
 * field and well apart from the brand colour in lightness, and an inset hero.
 */
export function heroSignals(
  geometry: HeroGeometry,
  ev: Pick<ColourEvidence, 'candidates'>,
  roles: Pick<ColourRoles, 'identity' | 'highlight' | 'monochrome'>
): Pick<HeroEvidence, 'monochrome' | 'roleSurface' | 'secondField' | 'heroInset'> {
  const of = (hex: string | null) => (hex ? ev.candidates.find((c) => near(c.hex, hex)) : undefined)
  const sources = (c: { sightings: Array<{ source: string }> }) =>
    new Set(c.sightings.map((s) => s.source))
  let roleSurface: HeroEvidence['roleSurface'] = null
  for (const [role, hex] of [
    ['accent', roles.identity.value],
    ['support', roles.highlight.value],
  ] as const) {
    const c = of(hex)
    if (!c || c.neutral || c.coverage < 0.1) continue
    if (![...sources(c)].some((s) => SECTION_SOURCES.has(s))) continue
    if (!roleSurface || c.coverage > roleSurface.coverage)
      roleSurface = { role, coverage: c.coverage }
  }
  const second = of(roles.highlight.value)
  const secondField =
    !!second &&
    !!roles.highlight.value &&
    [...sources(second)].some((s) => FIELD_SOURCES.has(s)) &&
    Math.abs(lightness(roles.highlight.value) - lightness(roles.identity.value)) >= 0.3
  const box = geometry.hero
  return {
    monochrome: roles.monochrome,
    roleSurface,
    secondField,
    heroInset: !!box && box[0] >= 0.02 * geometry.width && box[2] <= 0.98 * geometry.width,
  }
}
