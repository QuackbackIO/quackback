/**
 * The builder's chrome as plain rules. The right panel always keeps its
 * width: the portal overview with nothing picked, the picked block's own
 * panel, or the existing panels for the menu and other parts. Theme and Add
 * open as sheets over it, never in its place, with a way back to the pick.
 * Also the device widths, what undo and redo say, and the draft's state.
 */
import type { SectionType } from './blocks'
import { isMenuSelection } from './menu'
import type { StyleElement, StyleState } from './style-tokens'

/** The sheets that open over the right panel. */
export type Sheet = 'theme' | 'add'

export const SHEET_TITLES: Record<Sheet, string> = {
  theme: 'Theme',
  add: 'Add a block',
}

/** What the right panel holds under any sheet. */
export type PanelBase = 'overview' | 'block' | 'menu' | 'part'

/** The page sections the registry knows as blocks, by the pick that names them. */
const SECTION_TYPES: Record<string, SectionType> = {
  entries: 'changelog.entries',
  topics: 'help.topics',
  popular: 'help.popular',
  article: 'help.article',
  board: 'roadmap.board',
  vote: 'post.vote',
  details: 'post.details',
  comments: 'post.comments',
  request: 'support.request',
}

/** The registry block a page section pick is, or null for any other pick. */
export function sectionTypeOf(selection: string | null): SectionType | null {
  return selection && Object.hasOwn(SECTION_TYPES, selection) ? SECTION_TYPES[selection]! : null
}

export function panelBaseOf(selection: string | null): PanelBase {
  if (!selection) return 'overview'
  if (selection === 'hero' || selection.startsWith('block-') || sectionTypeOf(selection))
    return 'block'
  if (selection === 'header' || isMenuSelection(selection)) return 'menu'
  return 'part'
}

/** Where Theme opens for quick find: its main view, or an element's panel in a state. */
export interface ThemeAt {
  element: StyleElement | null
  state?: StyleState
}

/** The sheet open over the panel, whether Theme opens at its Style, and the view asked for. */
export interface PanelState {
  sheet: Sheet | null
  more: boolean
  at?: ThemeAt
}

export const NO_SHEET: PanelState = { sheet: null, more: false }

export type PanelAction =
  /** Add or Theme in the top bar: opens its sheet, or closes it when open. */
  | { type: 'toggle'; sheet: Sheet }
  /** Opens a sheet, Theme at its Style or at a view if asked, such as from a search. */
  | { type: 'open'; sheet: Sheet; more?: boolean; at?: ThemeAt }
  | { type: 'more'; open: boolean }
  | { type: 'close' }
  /** "Back to <pick>": the sheet goes, the pick's panel stays. */
  | { type: 'back' }
  /** Add placed a block, which is now picked, so its panel shows. */
  | { type: 'added' }

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'toggle':
      return state.sheet === action.sheet ? NO_SHEET : { sheet: action.sheet, more: false }
    case 'open':
      return {
        sheet: action.sheet,
        more: action.sheet === 'theme' && !!action.more,
        ...(action.sheet === 'theme' && action.at ? { at: action.at } : {}),
      }
    case 'more':
      return state.sheet === 'theme' && state.more !== action.open
        ? { ...state, more: action.open }
        : state
    case 'close':
    case 'back':
    case 'added':
      return state.sheet ? NO_SHEET : state
  }
}

export interface PanelView {
  base: PanelBase
  sheet: Sheet | null
  /** The open sheet's heading. */
  title: string | null
  /** The sheet's first crumb: what the panel under it shows, which it goes back to. */
  back: string | null
}

/**
 * What the right panel shows for a pick, with the sheets as they are; `name`
 * names what the panel under a sheet shows (the picked element's or block's
 * name, else the page's), the sheet's way back to it.
 */
export function panelView(
  state: PanelState,
  selection: string | null,
  name: string | undefined
): PanelView {
  return {
    base: panelBaseOf(selection),
    sheet: state.sheet,
    title: state.sheet ? SHEET_TITLES[state.sheet] : null,
    back: state.sheet && name ? name : null,
  }
}

/**
 * What Escape does: closes a sheet first, then goes up a level from a pick;
 * with nothing picked, it closes the page's panel, the only one it closes.
 */
export function escapeStep(
  state: PanelState,
  selection: string | null,
  pageOpen = false
): 'close-sheet' | 'up' | 'close-page' | null {
  if (state.sheet) return 'close-sheet'
  if (selection) return 'up'
  return pageOpen ? 'close-page' : null
}

/* Ask AI's pane */

/** Ask AI's pane on the left: its narrowest, widest and usual widths. */
export const AI_PANE = { min: 300, max: 480, width: 360 } as const

const clampPane = (width: number) => Math.round(Math.min(AI_PANE.max, Math.max(AI_PANE.min, width)))

/** How far one arrow key moves the pane's edge. */
const PANE_STEP = 16

/** The pane's width after a key on its edge, or null for a key that does not resize it. */
export function paneWidthOnKey(key: string, width: number): number | null {
  if (key === 'ArrowRight') return clampPane(width + PANE_STEP)
  if (key === 'ArrowLeft') return clampPane(width - PANE_STEP)
  if (key === 'Home') return AI_PANE.min
  if (key === 'End') return AI_PANE.max
  return null
}

/** The pane's width while its edge is dragged, kept within its limits. */
export const paneWidthAt = clampPane

/**
 * The pane as remembered on this device: collapsed or not, its width, and
 * whether it was opened or closed by hand. Left to itself it starts collapsed
 * once a brand match has run (`matched`), so the canvas has the room; a
 * choice made by hand is kept. A collapse remembered before choices were
 * marked was one.
 */
export function readAiPane(
  raw: string | null,
  matched = false
): { collapsed: boolean; width: number; chosen: boolean } {
  let saved: unknown = null
  try {
    saved = raw ? JSON.parse(raw) : null
  } catch {
    saved = null
  }
  const record = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
  const chosen = record.chosen === true || record.collapsed === true
  return {
    collapsed: chosen ? record.collapsed === true : matched,
    width: typeof record.width === 'number' ? clampPane(record.width) : AI_PANE.width,
    chosen,
  }
}

/* Devices */

export const DEVICE_WIDTHS = { desktop: 1280, tablet: 768, phone: 390 } as const
export type Device = keyof typeof DEVICE_WIDTHS

export const DEVICE_NAMES: Record<Device, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  phone: 'Phone',
}

/** What a change made on each device's canvas goes to: tablet has no values of its own. */
const DEVICE_EDITS: Record<Exclude<Device, 'desktop'>, string> = {
  tablet: 'Tablet shows your all-screens values',
  phone: 'Editing phone values',
}

/** The line over a tablet or phone canvas, with what a change there goes to; desktop needs none. */
export function deviceCaption(device: Device): string | null {
  if (device === 'desktop') return null
  return `${DEVICE_NAMES[device]}, ${DEVICE_WIDTHS[device]} px wide · ${DEVICE_EDITS[device]}`
}

/* Undo and redo */

export const undoTip = (label: string | null) => (label ? `Undo: ${label}` : 'Nothing to undo')
export const redoTip = (label: string | null) => (label ? `Redo: ${label}` : 'Nothing to redo')

/* The draft */

/** The draft's state in a few words, as the top bar's draft status says it. */
export function draftWords({
  count,
  saving,
  failed,
  blocked,
}: {
  count: number
  saving: boolean
  failed: boolean
  blocked: boolean
}): { text: string; tone: 'quiet' | 'draft' | 'warning' } {
  if (failed) return { text: 'Not saved. Retrying…', tone: 'warning' }
  if (blocked) return { text: 'Not saved: choose whose changes to keep', tone: 'warning' }
  if (saving) return { text: 'Saving…', tone: 'quiet' }
  if (count === 0) return { text: 'No changes', tone: 'quiet' }
  return { text: `${count === 1 ? '1 change' : `${count} changes`}, not live`, tone: 'draft' }
}
