/**
 * F6 and Shift+F6 move between the builder's regions in the order they
 * show: the top bar, Ask AI, the canvas and the properties. A toolbar takes focus on its button that takes Tab. Listened for on
 * the window, so it works from wherever focus is, the page's body included.
 */
export function cycleRegions(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>) {
  if (event.key !== 'F6') return
  const regions = [...document.querySelectorAll<HTMLElement>('[data-designer-region]')]
  if (!regions.length) return
  event.preventDefault()
  const at = regions.findIndex((region) => region.contains(document.activeElement))
  const next = regions[(at + (event.shiftKey ? -1 : 1) + regions.length) % regions.length]!
  const inside =
    next.getAttribute('role') === 'toolbar'
      ? next.querySelector<HTMLElement>('[tabindex="0"]')
      : null
  if (inside) return inside.focus()
  if (!next.hasAttribute('tabindex')) next.tabIndex = -1
  next.focus()
}
