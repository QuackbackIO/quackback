/** Where focus goes as the settings open and close. */
import type { Selection } from '@/lib/shared/design/outline'

/** Moves focus to the settings once a pick has opened them. */
export const focusSettings = () =>
  requestAnimationFrame(() => document.getElementById('designer-settings')?.focus())

/** Whether focus is in the settings, which close when the pick goes. */
export const inSettings = () =>
  !!document.getElementById('designer-settings')?.contains(document.activeElement)

/** Focus, after the settings it was in closed: the canvas, the page being edited. */
export const focusCanvas = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-canvas-region]')?.focus())

/** The picked block's chip name on the canvas. */
export const CHIP_NAME = '[data-editing-layer] [data-chip-name]'

/**
 * Puts focus on what a selector names once it is drawn: the tag of the
 * element just picked, drawn again once its box is measured. To `follow`,
 * it looks again each frame, as the chip of a block picked anew mounts once
 * its box is measured; once focus is there it is put back only when lost.
 */
export function keepFocus(selector: string, frames = 20, follow = false): void {
  let left = frames
  let seen: HTMLElement | null = null
  const tick = () => {
    const found = document.querySelector<HTMLElement>(selector)
    const active = document.activeElement
    const lost = !active || active === document.body || !active.isConnected
    if (found && found !== active && (!follow || !seen || lost)) found.focus()
    if (found) seen = found
    if (--left > 0 && (follow || !seen || seen.isConnected)) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/**
 * Focus, after a block was removed or copied: the chip of the block picked
 * in its place, else the canvas when nothing is left to pick.
 */
export const focusPicked = (picked: boolean) =>
  picked ? keepFocus(CHIP_NAME, 30, true) : focusCanvas()

/**
 * Opens a picked block's actions at a point in the builder's window, as a
 * right-click on its chip does: once the chip for that block is drawn, the
 * frame's right-click is handed to it there.
 */
export function openChipMenu(key: string, at: { x: number; y: number }, frames = 30): void {
  let left = frames
  const tick = () => {
    const chip = document.querySelector<HTMLElement>(
      `[data-editing-layer] [data-chip-for="${CSS.escape(key)}"]`
    )
    if (chip) {
      chip.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: at.x,
          clientY: at.y,
        })
      )
      return
    }
    if (--left > 0) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const settings = () => document.getElementById('designer-settings')

/** A row of "On this page", by the row's id. */
export const treeRowSelector = (id: string) => `[data-tree-row="${CSS.escape(id)}"]`

/**
 * Focus, once a part is picked from "On this page": the heading of the panel
 * it opened (under any sheet), so the keyboard starts at the top of it.
 */
export const focusHeading = () =>
  requestAnimationFrame(() => {
    const heading = settings()?.querySelector<HTMLElement>('[data-panel-under] h2')
    if (!heading) return settings()?.focus()
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
    heading.focus()
  })

/** A pick made from a row of "On this page": the row, and the part it picked. */
export interface TreeOrigin {
  row: string
  selection: Selection
}

/**
 * The row to return to on leaving a part for the page: the row that opened
 * it, else the part's own row.
 */
export function treeReturnRow(origin: TreeOrigin | null, leaving: Selection | null): string | null {
  if (origin && origin.selection === leaving) return origin.row
  return leaving
}

/**
 * Focus, after Escape stepped up with focus in the properties: back on the
 * page, the tree row that opened the part, or the tree's own stop where that
 * row is not drawn (a closed menu, a block removed); else the properties, a
 * level up.
 */
export const focusAfterStepUp = ({ toPage, row }: { toPage: boolean; row: string | null }) =>
  requestAnimationFrame(() => {
    const panel = settings()
    const found = toPage
      ? ((row ? panel?.querySelector<HTMLElement>(treeRowSelector(row)) : null) ??
        panel?.querySelector<HTMLElement>('[role=tree] [tabindex="0"]'))
      : null
    if (found) found.focus()
    else panel?.focus()
  })
