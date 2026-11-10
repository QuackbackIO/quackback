/**
 * The colours a decided hero is drawn in, as design fields: a measured band
 * colour no role holds, a third colour of the logo, and a glow's colour.
 * A measured colour joins the design's extra colours, after the logo's.
 */
import { oklab } from '../extract/color'
import { hexRgb } from '../extract/roles-places'
import type { BrandChange } from './brand-decide'
import type { HeroDecision } from './hero-rules'

const change = (path: string, value: unknown, why: string): BrandChange => ({ path, value, why })

/** Two colours this close (OKLab) are one, for a glow drawn in a colour the design has. */
const GLOW_NEAR = 0.05
const nearColour = (a: string, b: string) => {
  const [x, y] = [oklab(hexRgb(a)), oklab(hexRgb(b))]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < GLOW_NEAR
}

/**
 * The band's colour and its glow's. A band in a measured colour no role
 * holds takes an extra colour's place (the second, with two logo colours
 * already). A glow is drawn in an extra colour close to its measured one,
 * else its colour takes a free place; with none free, it is a light of the
 * band's own colour. A colour or glow left from a design before goes.
 */
export function heroColourChanges(
  hero: HeroDecision,
  /** The design's extra colours as the colour roles set them (the logo's further colours). */
  given?: readonly string[] | null
): BrandChange[] {
  const why = hero.why
  const out: BrandChange[] = []
  const extras = [...(given ?? [])].slice(0, 2)
  const before = extras.length
  const filled = !!hero.fill && hero.band !== 'none'
  if (filled) {
    const at = extras.length < 2 ? extras.length : 1
    extras[at] = hero.fill!
    out.push(change('layout.heroColour', at === 0 ? 'extra1' : 'extra2', why))
  } else if (hero.colour)
    out.push(change('layout.heroColour', hero.colour, 'the hero is in a third colour of the logo'))
  else out.push(change('layout.heroColour', null, 'the hero in the brand’s own colours'))
  const glowing = !!hero.glow && (hero.band === 'brand' || hero.band === 'support')
  out.push(change('layout.heroGlow', glowing ? hero.glow : null, why))
  const fill = glowing ? hero.glowFill : null
  let at = fill ? extras.findIndex((c) => nearColour(c, fill)) : -1
  if (fill && at < 0 && extras.length < 2) at = extras.push(fill) - 1
  out.push(change('layout.heroGlowColour', at < 0 ? null : at === 0 ? 'extra1' : 'extra2', why))
  if (filled || extras.length !== before)
    out.push(change('brand.light.extra', extras, `the hero's colour: ${why}`))
  return out
}
