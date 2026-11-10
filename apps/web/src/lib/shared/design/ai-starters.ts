/**
 * What Ask AI offers before the first request, from the design itself: to
 * match the brand until a match has run, and after that a few next edits
 * the design can take, none assuming a brand colour. A part picked offers
 * its own examples from the block registry; with nothing picked, the
 * starters keep to the page open.
 */
import { blockOf, SECTION_TYPES } from './blocks'
import { sectionTypeOf } from './builder-chrome'
import type { PortalDesign } from './schema'
import type { DesignerPage, PortalPageGates } from './paths'

/** Where the person is: the page open and the part picked on it, if any. */
export interface StarterPlace {
  page?: DesignerPage
  selection?: string | null
}

/** Most starters offered at once. */
const MOST = 3

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

/** The registry's type for a pick: the hero, a Home block by its type, or a page's section. */
function typeOfPick(design: PortalDesign, selection: string): string | null {
  if (selection === 'hero') return 'hero'
  if (selection.startsWith('block-')) {
    const id = selection.slice('block-'.length)
    return design.pages.home.blocks.find((block) => block.id === id)?.type ?? null
  }
  return sectionTypeOf(selection)
}

/** The example requests the registry gives for the part picked; none for a part it has none for. */
function pickedExamples(design: PortalDesign, selection: string | null | undefined): string[] {
  const type = selection ? typeOfPick(design, selection) : null
  return (type ? (blockOf(type)?.examples ?? []) : []).map((example) => example.request)
}

/** Up to three requests to start from; none is fine when nothing fits. */
export function aiStarters(
  design: PortalDesign,
  gates?: Partial<PortalPageGates>,
  at: StarterPlace = {}
): string[] {
  if (!hasMatched(design)) return [MATCH_STARTER]
  const picked = pickedExamples(design, at.selection)
  if (picked.length) return picked.slice(0, MOST)
  const page = at.page ?? 'home'
  const roadmapOnHome = design.pages.home.blocks.some((block) => block.type === 'roadmap')
  const corners = design.shape.corners
  // The page's own sections, each by its first example, before what every page can take.
  const sections =
    page === 'home'
      ? []
      : SECTION_TYPES.filter((type) => blockOf(type)?.pages.includes(page)).flatMap(
          (type) => blockOf(type)?.examples[0]?.request ?? []
        )
  return [
    ...sections,
    design.mode !== 'dark' && page !== 'status' && page !== 'post' ? 'Try a dark hero' : null,
    page === 'home' && design.nav.home.on && !roadmapOnHome && gates?.roadmap !== false
      ? 'Show the roadmap on Home'
      : null,
    corners === 'sharp'
      ? 'Softer corners'
      : corners === 'pill'
        ? 'Squarer corners'
        : 'Square corners',
  ]
    .filter((starter): starter is string => !!starter)
    .slice(0, MOST)
}
