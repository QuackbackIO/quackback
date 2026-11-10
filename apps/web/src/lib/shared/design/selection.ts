/**
 * What the builder has picked, one selection shared by the right panel, the
 * picked block's chip and the AI's context. A click on the page picks the
 * element under it (see element-pick.ts) and the block it is in, or the
 * block alone on its own box; a click on empty canvas lets it go. Escape
 * steps up a level: from the element to its block, then as panel-routes.ts
 * says, a Home block to Blocks, a menu link to the header, the rest to the page.
 */
import { upOf } from './panel-routes'

/** What is picked, what the pointer is over, and the link under the last click in the pick. */
export interface SelectionState {
  picked: string | null
  hovered: string | null
  link: string | null
  /** The element picked in the block, by its pick key, or null for the block itself. */
  element: string | null
  /** The element under the pointer. */
  hoveredElement: string | null
}

export const NOTHING_PICKED: SelectionState = {
  picked: null,
  hovered: null,
  link: null,
  element: null,
  hoveredElement: null,
}

export type SelectionAction =
  /** A click on the canvas, on a pickable block or not (null). */
  | { type: 'click'; key: string | null; href?: string | null; element?: string | null }
  /** A pick made elsewhere, such as the panel or the outline. */
  | { type: 'pick'; key: string | null }
  | { type: 'hover'; key: string | null; element?: string | null }
  /** An element of the picked block, reached by keyboard or from the panel; null for the block. */
  | { type: 'element'; element: string | null }
  | { type: 'escape' }
  /** The frame loaded a page: the link clicked and the hover belonged to the last one. */
  | { type: 'reload' }

/** Parts of the outline that are not blocks on the page: the site, and the blocks' own list. */
const NOT_BLOCKS = new Set(['site', 'home'])

/**
 * The block a click on the page picks: a Home block or a page section the
 * outline lists. Anything else on the page is empty canvas.
 */
export function canvasPickOf(key: string | null, outline: readonly string[]): string | null {
  if (!key || NOT_BLOCKS.has(key) || key.startsWith('site:')) return null
  return outline.includes(key) ? key : null
}

const changed = (state: SelectionState, next: SelectionState) =>
  (Object.keys(next) as Array<keyof SelectionState>).every((key) => state[key] === next[key])
    ? state
    : next

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return changed(state, {
        ...state,
        picked: action.key,
        link: action.key ? (action.href ?? null) : null,
        element: action.element ?? null,
      })
    case 'pick':
      return changed(state, { ...state, picked: action.key, link: null, element: null })
    case 'element':
      return changed(state, { ...state, element: state.picked ? action.element : null })
    case 'hover':
      return changed(state, {
        ...state,
        hovered: action.key,
        hoveredElement: action.element ?? null,
      })
    case 'escape':
      return state.element && state.picked
        ? changed(state, { ...state, element: null })
        : changed(state, { ...state, picked: upOf(state.picked), link: null, element: null })
    case 'reload':
      return changed(state, { ...state, hovered: null, link: null, hoveredElement: null })
  }
}
