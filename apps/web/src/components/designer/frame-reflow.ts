/**
 * Home's blocks gliding to their new places in the canvas frame after a
 * layout change, rather than jumping: where each block was is noted before
 * the change, and once the frame has drawn the change, each block that moved
 * slides from its old place to its new one. Blocks are matched by their
 * key, as the page may draw them afresh. Still with reduced motion.
 */

const BLOCKS = '[data-qb-grid] > [data-qb-section]'
/** How many frames to wait for the page to draw the change. */
const WAIT_FRAMES = 30
const DURATION_MS = 180

/** Where each of Home's blocks is now, by its key. */
export function snapshotBlocks(doc: Document | null | undefined): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>()
  if (!doc) return out
  for (const element of doc.querySelectorAll(BLOCKS))
    out.set(element.getAttribute('data-qb-section')!, element.getBoundingClientRect())
  return out
}

/** Slides each block from where it was to where the frame now draws it, once it has. */
export function playReflow(doc: Document | null | undefined, before: Map<string, DOMRect>): void {
  const win = doc?.defaultView
  if (!doc || !win || !before.size) return
  if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  let frames = 0
  const tick = () => {
    const moved: Array<[Element, number, number]> = []
    for (const element of doc.querySelectorAll(BLOCKS)) {
      const was = before.get(element.getAttribute('data-qb-section')!)
      if (!was) continue
      const now = element.getBoundingClientRect()
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved.push([element, dx, dy])
    }
    if (!moved.length) {
      if (++frames < WAIT_FRAMES) win.requestAnimationFrame(tick)
      return
    }
    for (const [element, dx, dy] of moved)
      element.animate?.(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: DURATION_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
      )
  }
  win.requestAnimationFrame(tick)
}
