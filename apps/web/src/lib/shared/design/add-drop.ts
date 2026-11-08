/**
 * Dragging a block from Add onto the page: the cell a new block lands on
 * under the pointer, at its usual size, and when a drop is refused. Pure, so
 * the builder's drag and its tests read it alike.
 */
import { blockOf } from './blocks'
import { columnAt, rowAt, type GridMetrics } from './grid-geometry'
import { GRID_COLUMNS, type GridPlace } from './home-grid'
import { HOME_BLOCKS_MAX, homeBlockTypes, type HomeBlockType } from './home'
import { BLOCK_SIZES } from './options'
import { BLOCK_NAMES, PAGE_NAMES, type DesignerPage } from './outline'
import type { PortalPageGates, PortalPageType } from './paths'
import type { PortalDesign } from './schema'

/** The part a block needs on, when it needs one. */
const NEEDS: Partial<Record<HomeBlockType, PortalPageType>> = {
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

/**
 * The cell a new block of `type` lands on with the pointer at `point`, in
 * the frame's viewport: its usual width centred on the pointer, its top in
 * the row the pointer is in, kept inside the grid.
 */
export function dropCell(
  m: GridMetrics,
  type: HomeBlockType,
  point: { x: number; y: number }
): Pick<GridPlace, 'x' | 'y'> {
  const [w] = BLOCK_SIZES[type].size
  const column = (m.width - m.columnGap * (m.columns - 1)) / m.columns
  const width = w * column + (w - 1) * m.columnGap
  return {
    x: columnAt(m, point.x - m.left - width / 2, w),
    y: rowAt(m, point.y - m.top - m.unit / 2),
  }
}

/**
 * Why a block cannot be dropped here, in a short line; null when it can.
 * Blocks go on Home, in the desktop view where the grid has its twelve
 * columns; one Home holds once is not added again, nor any once Home is full.
 */
export function addDropRefusal(
  design: PortalDesign,
  gates: PortalPageGates,
  type: HomeBlockType,
  at: { page: DesignerPage; columns: number | null }
): string | null {
  const blocks = design.pages.home.blocks
  const need = NEEDS[type]
  if (!homeBlockTypes(gates).includes(type) && need)
    return `Turn on ${PAGE_NAMES[need]} to add this block.`
  if (blocks.length >= HOME_BLOCKS_MAX) return `Home holds ${HOME_BLOCKS_MAX} blocks.`
  if (blockOf(type)?.repeat === 'once' && blocks.some((block) => block.type === type))
    return `${BLOCK_NAMES[type]} is on Home already.`
  if (at.page !== 'home') return 'Goes on Home. Click it to add it there.'
  if (at.columns !== GRID_COLUMNS) return 'Drop blocks in the desktop view.'
  return null
}

/** What is said once a block is dropped, counting rows and columns from one. */
export function addedWords(name: string, place: Pick<GridPlace, 'x' | 'y'>): string {
  return `${name} added at row ${place.y + 1}, column ${place.x + 1}.`
}
