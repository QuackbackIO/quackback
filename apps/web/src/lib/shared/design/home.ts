/**
 * Home's blocks as Appearance makes them: a new block with sensible options,
 * and the starter layout a workspace begins with, built from the pages it has.
 */
import { BLOCK_WIDTHS } from './options'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'

export type HomeBlock = PortalDesign['pages']['home']['blocks'][number]
export type HomeBlockType = HomeBlock['type']

const WELCOME_TEXT = 'Welcome! Share your ideas, see what is coming next and find help.'

/** A block of `type` with its defaults, at its first allowed width unless one is given. */
export function newBlock(type: HomeBlockType, width?: HomeBlock['width']): HomeBlock {
  const at = width && BLOCK_WIDTHS[type].includes(width) ? width : BLOCK_WIDTHS[type][0]!
  switch (type) {
    case 'welcome':
      return {
        type,
        width: at,
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: WELCOME_TEXT }] }],
        },
      } as HomeBlock
    case 'ideas':
      return { type, width: at, sort: 'trending', count: 3 }
    case 'updates':
      return { type, width: at, count: 3 }
    case 'roadmap':
      return { type, width: at, roadmapId: null }
    case 'help_topics':
      return { type, width: at, categoryIds: [] }
    case 'links':
      return { type, width: at, links: [{ label: 'Our website', url: 'https://example.com' }] }
    default:
      return { type, width: at } as HomeBlock
  }
}

/**
 * The layout a workspace starts with: Welcome; Share an idea with Status;
 * Top ideas with Latest updates; the roadmap; help topics. A block whose page
 * is off is left out.
 */
export function starterHomeBlocks(gates: PortalPageGates): HomeBlock[] {
  const wanted: Array<[HomeBlockType, HomeBlock['width'], boolean]> = [
    ['welcome', 'full', true],
    ['composer', 'two_thirds', gates.feedback],
    ['status', 'third', gates.status],
    ['ideas', 'half', gates.feedback],
    ['updates', 'half', gates.changelog],
    ['roadmap', 'full', gates.roadmap],
    ['help_topics', 'full', gates.help],
  ]
  return wanted.filter(([, , on]) => on).map(([type, width]) => newBlock(type, width))
}

/** The block types a workspace's Home can show, from the pages it has. Links and welcome need none. */
export function homeBlockTypes(gates: PortalPageGates): HomeBlockType[] {
  const needs: Record<HomeBlockType, boolean> = {
    welcome: true,
    links: true,
    composer: gates.feedback,
    ideas: gates.feedback,
    roadmap: gates.roadmap,
    updates: gates.changelog,
    help_search: gates.help,
    help_topics: gates.help,
    status: gates.status,
    contact: gates.support,
  }
  return (Object.keys(needs) as HomeBlockType[]).filter((type) => needs[type])
}

/** Columns each width takes: six on a wide screen, two on a medium one. */
const COLUMNS = {
  wide: { third: 2, half: 3, two_thirds: 4, full: 6 },
  medium: { third: 1, half: 1, two_thirds: 2, full: 2 },
} as const
const ROW = { wide: 6, medium: 2 } as const

/**
 * The columns each block takes once its row is filled: a block that leaves
 * its row short, because the next will not fit beside it or it is the last,
 * grows to the row's end, so Home has no holes.
 */
export function filledSpans(widths: HomeBlock['width'][], grid: 'wide' | 'medium'): number[] {
  const spans: number[] = widths.map((width) => COLUMNS[grid][width])
  let used = 0
  spans.forEach((span, index) => {
    if (used + span > ROW[grid]) {
      spans[index - 1] = spans[index - 1]! + ROW[grid] - used
      used = 0
    }
    used += span
  })
  if (spans.length) spans[spans.length - 1] = spans[spans.length - 1]! + ROW[grid] - used
  return spans
}
