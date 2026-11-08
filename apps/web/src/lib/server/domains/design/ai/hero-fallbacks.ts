/**
 * A hero the design can draw: where no text reads on the decided hero in the
 * brand's colours, the first fallback the design keeps.
 */
import type { HeroDecision } from './hero-rules'

/**
 * What to draw where the design cannot carry the hero's words readably, in
 * order: a line no text reads across becomes a mesh (the colours kept, beside
 * the words, the page under them), then a band in the brand colour, then in
 * the second; a band in one colour becomes the other. A gradient stays a
 * gradient before it goes flat (a design tool's purple-to-teal came out flat purple at
 * gate 11-02e); a mesh or ribbon leaves the page under the words, so it always
 * reads.
 */
export function heroFallbacks(hero: HeroDecision): HeroDecision[] {
  const unread = 'no text reads across it in these colours'
  const as = (band: HeroDecision['band'], blend: HeroDecision['blend'], why: string) => ({
    ...hero,
    band,
    blend,
    why: `${hero.why}; ${why}`,
  })
  switch (hero.band) {
    case 'blend':
      return hero.blend === 'linear' || hero.blend === null
        ? [
            as('blend', 'mesh', `${unread}, so the colours sit beside the words`),
            as('brand', null, `${unread}, so the band is the brand colour`),
            as('support', null, `${unread}, so the band is the second colour`),
          ]
        : [as('brand', null, `${unread}, so the band is the brand colour`)]
    case 'brand':
      return [as('support', null, `${unread}, so the band is the second colour`)]
    case 'support':
      return [as('brand', null, `${unread}, so the band is the brand colour`)]
    default:
      return []
  }
}

/**
 * The hero, or the first of its fallbacks, whose band the design keeps: the
 * changes are applied with each in turn until the band is not refused (the
 * readability check refuses a band no text reads on, in either mode).
 */
export function readableHero<R extends { refused: Array<{ path: string }> }>(
  hero: HeroDecision,
  applyWith: (hero: HeroDecision) => R
): { hero: HeroDecision; result: R } {
  const first = applyWith(hero)
  if (!first.refused.some((r) => r.path === 'layout.hero')) return { hero, result: first }
  for (const alt of heroFallbacks(hero)) {
    const result = applyWith(alt)
    if (!result.refused.some((r) => r.path === 'layout.hero')) return { hero: alt, result }
  }
  return { hero, result: first }
}
