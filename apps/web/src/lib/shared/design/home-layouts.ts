/**
 * Home layouts: arrangements of Home's blocks to start from. A layout puts
 * the blocks it names on the grid in its order, each its columns of twelve
 * wide and its usual height, packed in rows; it keeps each block already on
 * Home with its heading and settings. Blocks it does not name follow below
 * at their own sizes, so nothing written is lost. A block whose page is off
 * is left out.
 */
import { newBlock, HOME_BLOCKS_MAX, type HomeBlock, type HomeBlockType } from './home'
import { bottomOf, GRID_COLUMNS, type GridPlace } from './home-grid'
import { composerInHero } from './main-action'
import { BLOCK_SIZES } from './options'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'

export interface HomeLayout {
  id: string
  label: string
  description: string
  /** Each block and its columns of twelve. */
  blocks: ReadonlyArray<readonly [HomeBlockType, number]>
}

export const HOME_LAYOUTS: readonly HomeLayout[] = [
  {
    id: 'feedback',
    label: 'Feedback first',
    description: 'Asking, then the top posts and the roadmap.',
    blocks: [
      ['composer', 12],
      ['ideas', 8],
      ['status', 4],
      ['roadmap', 12],
      ['updates', 6],
      ['help_search', 6],
    ],
  },
  {
    id: 'help',
    label: 'Help first',
    description: 'Search and topics lead.',
    blocks: [
      ['help_search', 12],
      ['help_topics', 8],
      ['contact', 4],
      ['ideas', 6],
      ['updates', 6],
    ],
  },
  {
    id: 'roadmap',
    label: 'Roadmap and updates',
    description: 'What is coming and what shipped.',
    blocks: [
      ['roadmap', 12],
      ['updates', 8],
      ['status', 4],
      ['composer', 6],
      ['ideas', 6],
    ],
  },
  {
    id: 'everything',
    label: 'Everything',
    description: 'A welcome and a block for each page.',
    blocks: [
      ['welcome', 12],
      ['composer', 8],
      ['status', 4],
      ['ideas', 6],
      ['updates', 6],
      ['roadmap', 12],
      ['help_topics', 12],
    ],
  },
]

const PAGE_OF: Partial<Record<HomeBlockType, keyof PortalPageGates>> = {
  composer: 'feedback',
  ideas: 'feedback',
  boards: 'feedback',
  roadmap: 'roadmap',
  updates: 'changelog',
  help_search: 'help',
  help_topics: 'help',
  status: 'status',
  contact: 'support',
}

const onHere = (type: HomeBlockType, gates: PortalPageGates) => {
  const page = PAGE_OF[type]
  return !page || gates[page]
}

/** Whether a workspace has what a layout leads with, such as Help for "Help first". */
export function layoutFits(layout: HomeLayout, gates: PortalPageGates): boolean {
  return onHere(layout.blocks[0]![0], gates)
}

interface Entry {
  block: HomeBlock
  w: number
  h: number
}

/**
 * Entries packed into rows that fill the grid: a full-width block takes its
 * own row; narrower ones share a row while they fit, and two that do not fit
 * side by side are paired as halves (when both can be that narrow) rather
 * than each stretched alone across the page. The last block in a row takes
 * what is left of it.
 */
function packRows(entries: readonly Entry[], startY: number): GridPlace[] {
  const rows: Entry[][] = []
  let open: Entry[] | null = null
  const halfFits = (entry: Entry) => BLOCK_SIZES[entry.block.type].min[0] <= GRID_COLUMNS / 2
  for (const original of entries) {
    const entry = { ...original, w: Math.max(1, Math.min(GRID_COLUMNS, original.w)) }
    const used = open?.reduce((sum, each) => sum + each.w, 0) ?? 0
    if (entry.w >= GRID_COLUMNS) {
      rows.push([entry])
      open = null
    } else if (open && used + entry.w <= GRID_COLUMNS) {
      open.push(entry)
    } else if (open?.length === 1 && halfFits(open[0]!) && halfFits(entry)) {
      open[0]!.w = GRID_COLUMNS / 2
      entry.w = GRID_COLUMNS / 2
      open.push(entry)
      open = null
    } else {
      open = [entry]
      rows.push(open)
    }
  }
  const places: GridPlace[] = []
  let y = startY
  for (const row of rows) {
    const h = Math.max(...row.map((entry) => entry.h))
    let x = 0
    row.forEach((entry, i) => {
      const w = i === row.length - 1 ? GRID_COLUMNS - x : entry.w
      places.push({ x, y, w, h })
      x += w
    })
    y += h
  }
  return places
}

/**
 * Home's blocks in a layout's arrangement; see the file's note. With the
 * composer in the band (`band`), its grid place draws nothing, so it is put
 * first, across the page, where it leaves no hole and comes back first if it
 * is taken out of the band; the rest are packed without it. Blocks the
 * layout does not name follow, those Home draws before those whose page is
 * off, so a hidden block never leaves a hole among drawn ones.
 */
export function arrangeHome(
  blocks: readonly HomeBlock[],
  layout: HomeLayout,
  gates: PortalPageGates,
  options: { band?: boolean } = {}
): HomeBlock[] {
  const left = [...blocks]
  const take = (type: HomeBlockType) => {
    const at = left.findIndex((block) => block.type === type)
    return at < 0 ? newBlock(type) : left.splice(at, 1)[0]!
  }
  const inBand = options.band && onHere('composer', gates)
  const composer = inBand ? take('composer') : null
  const named: Entry[] = layout.blocks
    .filter(([type]) => onHere(type, gates) && !(inBand && type === 'composer'))
    .map(([type, w]) => ({ block: take(type), w, h: BLOCK_SIZES[type].size[1] }))
  const top: Entry[] = composer
    ? [{ block: composer, w: GRID_COLUMNS, h: BLOCK_SIZES.composer.size[1] }]
    : []
  const rest = (drawn: boolean): Entry[] =>
    left
      .filter((block) => onHere(block.type, gates) === drawn)
      .map((block) => ({ block, w: block.grid.w, h: block.grid.h }))
  const out: HomeBlock[] = []
  let y = 0
  for (const group of [top, named, rest(true), rest(false)]) {
    const places = packRows(group, y)
    group.forEach(({ block }, i) => out.push({ ...block, grid: places[i]! }))
    y = bottomOf([{ x: 0, y, w: 0, h: 0 }, ...places])
  }
  return out.slice(0, HOME_BLOCKS_MAX)
}

/** A Home already arranged, as a layout of its own (order and widths), or null for the default Home. */
export function keptHomeLayout(blocks: readonly HomeBlock[]): HomeLayout | null {
  if (!blocks.length) return null
  const order = [...blocks].sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x)
  return {
    id: 'kept',
    label: 'As arranged',
    description: 'As it was arranged.',
    blocks: order.map((block) => [block.type, block.grid.w] as const),
  }
}

/** Gives a draft being changed a Home layout in place. */
export function takeHomeLayout(
  draft: PortalDesign,
  layout: HomeLayout,
  gates: PortalPageGates
): void {
  draft.pages.home.blocks = arrangeHome(draft.pages.home.blocks, layout, gates, {
    band: composerInHero(draft.pages.home),
  })
}
