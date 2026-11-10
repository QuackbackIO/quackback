/**
 * What Ask AI offers before the first request, from the design itself: to
 * match the brand while the portal still wears the house look, and after
 * that a few next edits the design can take, none assuming a brand colour.
 */
import { defaultDesign, type PortalDesign } from './schema'
import type { PortalPageGates } from './paths'

/** The chip that starts a brand match: it points at the box, it sends nothing. */
export const MATCH_STARTER = 'Match my brand'

/** What the box says once Match my brand is picked. */
export const MATCH_HINT = 'Paste your website or screenshots'

/** Whether the portal has a brand of its own: a logo, a brand colour or a font set. */
export function hasBrand(design: PortalDesign): boolean {
  const house = defaultDesign().brand
  const { logo, light, fonts } = design.brand
  return (
    !!(logo.mark.light ?? logo.wordmark.light) ||
    light.accent !== house.light.accent ||
    JSON.stringify(fonts ?? null) !== JSON.stringify(house.fonts ?? null)
  )
}

/** Up to three requests to start from; none is fine when nothing fits. */
export function aiStarters(design: PortalDesign, gates?: Partial<PortalPageGates>): string[] {
  if (!hasBrand(design)) return [MATCH_STARTER]
  const roadmapOnHome = design.pages.home.blocks.some((block) => block.type === 'roadmap')
  const corners = design.shape.corners
  return [
    design.mode !== 'dark' ? 'Try a dark hero' : null,
    design.nav.home.on && !roadmapOnHome && gates?.roadmap !== false
      ? 'Show the roadmap on Home'
      : null,
    corners === 'sharp'
      ? 'Softer corners'
      : corners === 'pill'
        ? 'Squarer corners'
        : 'Square corners',
  ].filter((starter): starter is string => !!starter)
}
