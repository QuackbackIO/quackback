/** Where focus goes as the settings open and close. */

/** Moves focus to the settings once a pick has opened them. */
export const focusSettings = () =>
  requestAnimationFrame(() => document.getElementById('designer-settings')?.focus())

/** Whether focus is in the settings, which close when the pick goes. */
export const inSettings = () =>
  !!document.getElementById('designer-settings')?.contains(document.activeElement)

/** Focus, after the settings it was in closed: the canvas, the page being edited. */
export const focusCanvas = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-canvas-region]')?.focus())
