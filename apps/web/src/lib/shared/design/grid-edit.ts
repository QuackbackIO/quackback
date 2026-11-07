/**
 * Moving and resizing one Home block on the grid, by drag or by key: the
 * blocks Home shows laid out as the page draws them, the change made, and
 * the places written back into the design in reading order. Blocks Home does
 * not show keep their places. Also what the keys are and what is said.
 */
import { moveItem, nudge, resizeItem, settle, type GridPlace, type Nudge } from './home-grid'
import { homeGridItems, placeHomeBlocks } from './home'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'

/** A change to one block: a keyboard step, or a cell to move to or a size, as a drag gives. */
export type GridChange =
  { nudge: Nudge } | { move: Pick<GridPlace, 'x' | 'y'> } | { size: Pick<GridPlace, 'w' | 'h'> }

const ARROWS: Record<string, [move: Nudge, resize: Nudge]> = {
  ArrowLeft: ['left', 'narrower'],
  ArrowRight: ['right', 'wider'],
  ArrowUp: ['up', 'shorter'],
  ArrowDown: ['down', 'taller'],
}

/** The step a key makes: an arrow moves a block a cell, Shift and an arrow resizes it. */
export function stepOfKey(event: {
  key: string
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}): Nudge | null {
  const steps = ARROWS[event.key]
  if (!steps || event.altKey || event.ctrlKey || event.metaKey) return null
  return steps[event.shiftKey ? 1 : 0]
}

/** Whether a step changes a block's size rather than where it sits. */
export const resizes = (change: GridChange) =>
  'size' in change ||
  ('nudge' in change && ['wider', 'narrower', 'taller', 'shorter'].includes(change.nudge))

/**
 * Makes one change to the Home block with this id, in place, and returns
 * where it ends; null, leaving the design as it was, when nothing changes
 * or Home does not show the block.
 */
export function editGrid(
  design: PortalDesign,
  gates: PortalPageGates,
  id: string,
  change: GridChange
): GridPlace | null {
  const items = settle(homeGridItems(design.pages.home, gates))
  const item = items.find((one) => one.id === id)
  if (!item) return null
  const next =
    'nudge' in change
      ? nudge(items, id, change.nudge)
      : 'move' in change
        ? moveItem(items, id, change.move.x, change.move.y)
        : resizeItem(items, id, change.size.w, change.size.h)
  const moved = next?.find((one) => one.id === id)
  const before = homeGridItems(design.pages.home, gates)
  const same =
    !next ||
    next.every((one) => {
      const was = before.find((other) => other.id === one.id)!
      return was.x === one.x && was.y === one.y && was.w === one.w && was.h === one.h
    })
  if (same || !moved) return null
  placeHomeBlocks(design, next)
  return { x: moved.x, y: moved.y, w: moved.w, h: moved.h }
}

const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`

/** What is said once a block moves, counting rows and columns from one. */
export function movedWords(name: string, place: GridPlace): string {
  return `${name} moved to row ${place.y + 1}, column ${place.x + 1}.`
}

/** What is said once a block is resized. */
export function resizedWords(name: string, place: GridPlace): string {
  return `${name} resized to ${many(place.w, 'column', 'columns')} by ${many(place.h, 'row', 'rows')}.`
}
