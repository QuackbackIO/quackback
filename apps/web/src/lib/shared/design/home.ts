/**
 * Home's blocks as Appearance makes them: a new block with sensible options,
 * and the starter layout a workspace begins with, built from the pages it has.
 */
import {
  bottomOf,
  GRID_COLUMNS,
  moveItem,
  packWidths,
  readingOrder,
  settle,
  type GridItem,
  type GridPlace,
} from './home-grid'
import { BLOCK_SIZES } from './options'
import { composerInHero } from './main-action'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'

export type HomeBlock = PortalDesign['pages']['home']['blocks'][number]
export type HomeBlockType = HomeBlock['type']

const WELCOME_TEXT = 'Welcome! Share feedback, see what is coming next and find help.'

/** A new block's id: ten random letters and digits. */
function blockId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('')
}

/**
 * The design with an id on every Home block. A block without one takes its
 * type and its place among blocks of that type, so the same document always
 * gets the same ids and two readings of it agree.
 */
export function withBlockIds<T extends PortalDesign>(design: T): T {
  const blocks = design.pages.home.blocks
  const ids = blocks.map((block) => block.id)
  if (ids.every((id, i) => id && ids.indexOf(id) === i)) return design
  // A repeated id is renamed where it repeats, so each still names one block.
  const reserved = new Set(ids.filter((id): id is string => !!id))
  const used = new Set<string>()
  const seen = new Map<string, number>()
  const named = blocks.map((block) => {
    const n = (seen.get(block.type) ?? 0) + 1
    seen.set(block.type, n)
    if (block.id && !used.has(block.id)) {
      used.add(block.id)
      return block
    }
    let id = `${block.type.replace(/_/g, '')}${String(n).padStart(3, '0')}`
    while (used.has(id) || reserved.has(id)) id = `${id}x`
    used.add(id)
    return { ...block, id }
  })
  return { ...design, pages: { ...design.pages, home: { ...design.pages.home, blocks: named } } }
}

/** A block of `type` with its defaults, at its usual size, at the top left unless placed. */
export function newBlock(type: HomeBlockType, place?: Partial<GridPlace>): HomeBlock {
  const [w, h] = BLOCK_SIZES[type].size
  return { id: blockId(), ...blockOf(type), grid: { x: 0, y: 0, w, h, ...place } } as HomeBlock
}

/** A Home block without its place, kept apart by type. */
type Unplaced = HomeBlock extends infer B ? (B extends unknown ? Omit<B, 'grid'> : never) : never

function blockOf(type: HomeBlockType): Unplaced {
  switch (type) {
    case 'welcome':
      return {
        type,
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: WELCOME_TEXT }] }],
        },
      } as Unplaced
    case 'ideas':
      return { type, sort: 'trending', count: 3 }
    case 'updates':
      return { type, count: 3 }
    case 'roadmap':
      return { type, roadmapId: null }
    case 'help_topics':
      return { type, categoryIds: [] }
    case 'links':
      return { type, links: [{ label: 'Our website', url: 'https://example.com' }] }
    default:
      return { type } as Unplaced
  }
}

/** The starter layout's rows after Welcome: each block, its columns of twelve and the part it needs. */
const STARTER_ROWS: Array<Array<[HomeBlockType, number, keyof PortalPageGates]>> = [
  [
    ['composer', 8, 'feedback'],
    ['status', 4, 'status'],
  ],
  [
    ['ideas', 6, 'feedback'],
    ['updates', 6, 'changelog'],
  ],
  [['roadmap', 12, 'roadmap']],
  [['help_topics', 12, 'help']],
]

/**
 * Blocks of the given types and columns, packed in rows in that order, each
 * row as tall as its tallest block and its last block reaching its end.
 */
export function packedBlocks(
  entries: ReadonlyArray<readonly [HomeBlockType, number]>,
  startY = 0
): HomeBlock[] {
  const places = packWidths(
    entries.map(([type, w], i) => ({ id: String(i), w, h: BLOCK_SIZES[type].size[1] })),
    startY
  )
  return entries.map(([type], i) => {
    const { x, y, w, h } = places[i]!
    return newBlock(type, { x, y, w, h })
  })
}

/**
 * The layout a workspace starts with: Welcome; Write a post with Status;
 * Top posts with Latest updates; the roadmap; help topics. A block whose page
 * is off is left out. The part that leads (the first in the menu) moves its
 * row to the top, with its own block first in it; a part with no block here
 * leaves the usual order. Made only for a Home that has no blocks yet.
 */
export function starterHomeBlocks(
  gates: PortalPageGates,
  lead?: keyof PortalPageGates | null
): HomeBlock[] {
  const rows = STARTER_ROWS.map((row) => row.filter(([, , part]) => gates[part])).filter(
    (row) => row.length > 0
  )
  const first = rows.findIndex((row) => row.some(([, , part]) => part === lead))
  const ordered = first > 0 ? [rows[first]!, ...rows.filter((_, at) => at !== first)] : rows
  const blocks = ordered.flatMap((row) =>
    [...row].sort(([, , a], [, , b]) => Number(b === lead) - Number(a === lead))
  )
  return packedBlocks([['welcome', 12], ...blocks.map(([type, w]) => [type, w] as const)])
}

/** The page each block shows the data of; a block whose page is off is not drawn. */
const PAGE_OF: Partial<Record<HomeBlockType, keyof PortalPageGates>> = {
  composer: 'feedback',
  ideas: 'feedback',
  roadmap: 'roadmap',
  updates: 'changelog',
  help_search: 'help',
  help_topics: 'help',
  status: 'status',
  contact: 'support',
}

/** The page a block needs that is off, so visitors do not see it; null when they do. */
export function blockPageOff(
  type: HomeBlockType,
  gates: PortalPageGates
): keyof PortalPageGates | null {
  const page = PAGE_OF[type]
  return page && !gates[page] ? page : null
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

/** Home's blocks as grid items, by id, at their least sizes. */
export function gridItemsOf(blocks: readonly HomeBlock[]): GridItem[] {
  return blocks.map((block, i) => {
    const [minW, minH] = BLOCK_SIZES[block.type].min
    return { id: block.id ?? `#${i}`, ...block.grid, minW, minH }
  })
}

/**
 * Writes places into Home's blocks, by id, and puts the blocks in reading
 * order, so the list of blocks, the page and a phone agree. Blocks the places
 * leave out keep theirs.
 */
export function placeHomeBlocks(design: PortalDesign, items: readonly GridItem[]): void {
  const byId = new Map(items.map((item) => [item.id, item]))
  const blocks = design.pages.home.blocks
  blocks.forEach((block, i) => {
    const item = byId.get(block.id ?? `#${i}`)
    if (item) block.grid = { x: item.x, y: item.y, w: item.w, h: item.h }
  })
  const order = new Map(readingOrder(gridItemsOf(blocks)).map((item, at) => [item.id, at]))
  const keyed = blocks.map((block, i) => [order.get(block.id ?? `#${i}`)!, block] as const)
  design.pages.home.blocks = keyed.sort(([a], [b]) => a - b).map(([, block]) => block)
}

/**
 * The blocks Home draws on its grid, as grid items: not one whose page is
 * off, nor the composer when it sits in the band, and the block beside one
 * of those widened over its columns, so the row it leaves has no hole. The portal and the builder
 * lay out the same ones, so what the builder moves is what the page shows.
 */
export function homeGridItems(
  home: PortalDesign['pages']['home'],
  gates: PortalPageGates
): GridItem[] {
  const shown = new Set(homeBlockTypes(gates))
  const band =
    composerInHero(home) && shown.has('composer')
      ? home.blocks.findIndex((block) => block.type === 'composer')
      : -1
  const items = gridItemsOf(home.blocks)
  const drawn = (i: number) => i !== band && shown.has(home.blocks[i]!.type)
  const kept = items.filter((_, i) => drawn(i))
  // A block left out would leave a hole in its row: the block beside it,
  // the same row and height, takes its columns, the one on its left first.
  const gaps = items.filter((_, i) => !drawn(i)).sort((a, b) => a.y - b.y || a.x - b.x)
  for (const gap of gaps) {
    const beside = (item: GridItem) => item.y === gap.y && item.h === gap.h
    const left = kept.findIndex((item) => beside(item) && item.x + item.w === gap.x)
    const right = kept.findIndex((item) => beside(item) && item.x === gap.x + gap.w)
    if (left >= 0) kept[left] = { ...kept[left]!, w: kept[left]!.w + gap.w }
    else if (right >= 0) kept[right] = { ...kept[right]!, x: gap.x, w: kept[right]!.w + gap.w }
  }
  return kept
}

/** Lays Home's blocks out afresh: in the grid, at least their sizes, none overlapping, floated up. */
export function settleHome(design: PortalDesign): void {
  placeHomeBlocks(design, settle(gridItemsOf(design.pages.home.blocks)))
}

/**
 * Swaps the places of two Home blocks, each keeping its size, then settles
 * the rest around them.
 */
function swapPlaces(design: PortalDesign, a: string, b: string): void {
  const items = gridItemsOf(design.pages.home.blocks)
  const one = items.find((item) => item.id === a)
  const two = items.find((item) => item.id === b)
  if (!one || !two) return
  const swapped = items.map((item) =>
    item === one
      ? { ...item, x: two.x, y: two.y }
      : item === two
        ? { ...item, x: one.x, y: one.y }
        : item
  )
  // The block moved earlier goes first, so it keeps the place it took.
  const first = one.y > two.y || (one.y === two.y && one.x > two.x) ? a : b
  placeHomeBlocks(
    design,
    settle([
      ...swapped.filter((item) => item.id === first),
      ...swapped.filter((item) => item.id !== first),
    ])
  )
}

/**
 * Moves the Home block with this id one place earlier or later in reading
 * order, by swapping places with its neighbour there; at an end, or for an
 * unknown id, nothing moves.
 */
export function moveHomeBlock(design: PortalDesign, id: string, by: -1 | 1): void {
  const order = readingOrder(gridItemsOf(design.pages.home.blocks))
  const at = order.findIndex((item) => item.id === id)
  const other = order[at + by]
  if (at < 0 || !other) return
  swapPlaces(design, id, other.id)
}

/**
 * Puts the Home block with this id at a place in reading order, counted
 * before it is taken out, as a drop between two blocks reads: 0 is first
 * and the number of blocks is last. An unknown id moves nothing.
 */
export function placeHomeBlock(design: PortalDesign, id: string, place: number): void {
  const count = design.pages.home.blocks.length
  const indexOf = () =>
    readingOrder(gridItemsOf(design.pages.home.blocks)).findIndex((item) => item.id === id)
  const from = indexOf()
  if (from < 0) return
  const to = Math.min(Math.max(0, place > from ? place - 1 : place), count - 1)
  for (let step = 0; step < count && indexOf() !== to; step++) {
    const before = indexOf()
    moveHomeBlock(design, id, to < before ? -1 : 1)
    if (indexOf() === before) return
  }
}

/** Where a block of this size goes under another: at its column, moved left to fit. */
function under(above: GridPlace, w: number): Pick<GridPlace, 'x' | 'y'> {
  return { x: Math.min(above.x, GRID_COLUMNS - w), y: above.y + above.h }
}

/** Adds a block, pushing down what is in its way, then settles Home; returns it. */
function addPlaced(design: PortalDesign, block: HomeBlock): HomeBlock {
  design.pages.home.blocks.push(block)
  const items = gridItemsOf(design.pages.home.blocks)
  const mine = items.find((item) => item.id === block.id)!
  placeHomeBlocks(design, settle([mine, ...items.filter((item) => item !== mine)]))
  return design.pages.home.blocks.find((one) => one.id === block.id)!
}

/**
 * Adds a new block under the Home block with id `after`, at its column,
 * pushing what is there down; without one, under every block. Returns it.
 */
export function insertHomeBlock(
  design: PortalDesign,
  type: HomeBlockType,
  after?: string | null
): HomeBlock {
  const blocks = design.pages.home.blocks
  const [w, h] = BLOCK_SIZES[type].size
  const above = blocks.find((block) => block.id === after)?.grid
  const place = above ? under(above, w) : { x: 0, y: bottomOf(blocks.map((block) => block.grid)) }
  return addPlaced(design, newBlock(type, { ...place, w, h }))
}

/**
 * Puts a new block on Home at a cell, as a drop from Add does: at its own
 * size, the blocks in its way moved down as moving a block moves them, then
 * everything floated up. Returns where it lands; null when Home does not
 * draw it on its grid (such as a composer in the band), where it is still added.
 */
export function insertHomeBlockAt(
  design: PortalDesign,
  gates: PortalPageGates,
  block: HomeBlock,
  at: Pick<GridPlace, 'x' | 'y'>
): GridPlace | null {
  const items = settle(homeGridItems(design.pages.home, gates))
  design.pages.home.blocks.push({ ...block, grid: { ...block.grid, x: 0, y: bottomOf(items) } })
  const mine = homeGridItems(design.pages.home, gates).find((item) => item.id === block.id)
  if (!mine) return null
  const next = moveItem([...items, mine], mine.id, at.x, at.y)
  placeHomeBlocks(design, next)
  const landed = next.find((item) => item.id === mine.id)!
  return { x: landed.x, y: landed.y, w: landed.w, h: landed.h }
}

/** Home holds at most this many blocks. */
export const HOME_BLOCKS_MAX = 12

/**
 * Adds a copy of the Home block with this id under it, the same size, with
 * its own id, and returns the copy; with Home full, or for an unknown id, it
 * adds nothing.
 */
export function duplicateHomeBlock(design: PortalDesign, id: string): HomeBlock | null {
  const blocks = design.pages.home.blocks
  const original = blocks.find((block) => block.id === id)
  if (!original || blocks.length >= HOME_BLOCKS_MAX) return null
  const copy = { ...structuredClone(original), id: blockId() }
  copy.grid = { ...original.grid, ...under(original.grid, original.grid.w) }
  return addPlaced(design, copy)
}
