/**
 * What Ask AI offers before the first request, from the design itself: to
 * match the brand until a match has run, and after that a few next edits
 * the design can take, none assuming a brand colour.
 */
import type { PortalDesign } from './schema'
import type { PortalPageGates } from './paths'

/** The chip that starts a brand match: it points at the box, it sends nothing. */
export const MATCH_STARTER = 'Match my brand'

/** What the box says once Match my brand is picked. */
export const MATCH_HINT = 'Paste your website or screenshots'

/**
 * Whether a brand match has ever run into this design. Not whether it holds a
 * logo or colour: onboarding places the workspace logo, which is no match.
 */
export function hasMatched(design: PortalDesign): boolean {
  return !!design.brand.matchedAt
}

/** Up to three requests to start from; none is fine when nothing fits. */
export function aiStarters(design: PortalDesign, gates?: Partial<PortalPageGates>): string[] {
  if (!hasMatched(design)) return [MATCH_STARTER]
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
