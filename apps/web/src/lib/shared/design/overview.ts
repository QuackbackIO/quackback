/**
 * What the builder says of the portal as a whole: where visitors land, and
 * the Home blocks Add suggests for the parts that are on.
 */
import { HOME_BLOCKS_MAX, type HomeBlockType } from './home'
import { PAGE_NAMES } from './outline'
import type { PortalPageGates, PortalPageType } from './paths'
import type { PortalDesign } from './schema'

/** A page's name in the menu: its own label, else the page's name. */
function menuName(item: { type: PortalPageType; label?: string }): string {
  return item.label ?? PAGE_NAMES[item.type]
}

/** Where `/` takes a visitor, by the name the menu gives it. */
export function landingName(design: PortalDesign, gates: PortalPageGates): string {
  if (design.nav.home.on) return design.nav.home.label ?? 'Home'
  const first = design.nav.items.find(
    (item): item is Extract<typeof item, { shown: boolean }> =>
      item.type !== 'link' && item.shown && gates[item.type]
  )
  return first ? menuName(first) : PAGE_NAMES.feedback
}

/** A block to add to Home, for a part that is on and that Home does not show yet. */
export interface HomeSuggestion {
  id: 'help' | 'contact' | 'status' | 'updates'
  text: string
  type: HomeBlockType
  label: string
}

const HOME_SUGGESTIONS: Array<{
  id: 'help' | 'contact' | 'status' | 'updates'
  part: PortalPageType
  shownBy: HomeBlockType[]
  add: HomeBlockType
  /** What to do, after the part's name. */
  text: string
  label: string
}> = [
  {
    id: 'help',
    part: 'help',
    shownBy: ['help_search', 'help_topics'],
    add: 'help_search',
    text: 'Let visitors search it from Home.',
    label: 'Add help search',
  },
  {
    id: 'contact',
    part: 'support',
    shownBy: ['contact'],
    add: 'contact',
    text: 'Point stuck visitors to it from Home.',
    label: 'Add a contact block',
  },
  {
    id: 'status',
    part: 'status',
    shownBy: ['status'],
    add: 'status',
    text: 'Show how things are running on Home.',
    label: 'Add status',
  },
  {
    id: 'updates',
    part: 'changelog',
    shownBy: ['updates'],
    add: 'updates',
    text: 'Show the latest updates on Home.',
    label: 'Add latest updates',
  },
]

/** At most this many suggestions show at once. */
const MAX_SUGGESTIONS = 3

/**
 * What Add suggests first: a Home block for each part that is on and that
 * Home does not show, a part just turned on leading. Nothing while Home is
 * off or full.
 */
export function homeSuggestions(
  design: PortalDesign,
  gates: PortalPageGates,
  /** Parts turned on since the builder last opened. */
  fresh: readonly PortalPageType[] = []
): HomeSuggestion[] {
  const blocks = design.pages.home.blocks
  if (!design.nav.home.on || blocks.length >= HOME_BLOCKS_MAX) return []
  const missing = HOME_SUGGESTIONS.filter(
    (each) => gates[each.part] && !blocks.some((block) => each.shownBy.includes(block.type))
  )
  const isFresh = (part: PortalPageType) => fresh.includes(part)
  return [
    ...missing.filter((each) => isFresh(each.part)),
    ...missing.filter((each) => !isFresh(each.part)),
  ]
    .slice(0, MAX_SUGGESTIONS)
    .map((each) => ({
      id: each.id,
      text: `${PAGE_NAMES[each.part]} is ${isFresh(each.part) ? 'new' : 'on'}. ${each.text}`,
      type: each.add,
      label: each.label,
    }))
}
