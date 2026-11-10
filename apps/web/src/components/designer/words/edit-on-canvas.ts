/**
 * Asking the canvas to edit words where they sit, from anywhere in the
 * builder: a panel's Edit says which words, by their field
 * ("block-<id>.heading"), and the words layer, which holds the frame, asks the
 * frame to open them as a double-click on them would.
 */

/** The builder's own event for it, heard by the words layer. */
export const EDIT_ON_CANVAS = 'designer:words-edit'

export function editOnCanvas(field: string): void {
  window.dispatchEvent(new CustomEvent<string>(EDIT_ON_CANVAS, { detail: field }))
}
