import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import { markSuggestionPopup } from './suggestion-popup-marker'

/** Composer is at the bottom of the inbox; always sit above the caret. */
export const SUGGESTION_PLACEMENT = 'top-start' as const

async function applySuggestionPopupPosition(
  floatingEl: HTMLElement,
  getClientRect: () => DOMRect | null
): Promise<void> {
  const rect = getClientRect()
  if (!rect) return
  const { x, y } = await computePosition({ getBoundingClientRect: () => rect }, floatingEl, {
    strategy: 'fixed',
    placement: SUGGESTION_PLACEMENT,
    middleware: [
      offset(8),
      // Prefer above the caret (inbox composer sits at the bottom), but flip
      // below when the caret is near the top of the viewport — e.g. the first
      // lines of the help-center/changelog editors. Horizontal slide stays
      // off: the menu must not drift down onto the composer it annotates.
      flip({ padding: 8 }),
      shift({ padding: 8, mainAxis: false }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(96, availableHeight)}px`
          elements.floating.style.overflowY = 'auto'
        },
      }),
    ],
  })
  Object.assign(floatingEl.style, { left: `${x}px`, top: `${y}px` })
}

/**
 * Keep a body-level suggestion popup above `getClientRect`. Re-runs when the
 * list gains height (first paint is often 0) so it does not grow downward
 * over the composer. Call the returned function on teardown.
 */
export function attachSuggestionPopupPosition(
  floatingEl: HTMLElement,
  getClientRect: (() => DOMRect | null) | null
): () => void {
  if (!getClientRect) return () => {}
  const virtualEl = { getBoundingClientRect: () => getClientRect() ?? new DOMRect() }
  return autoUpdate(virtualEl, floatingEl, () => {
    void applySuggestionPopupPosition(floatingEl, getClientRect)
  })
}

/** Start/stop helper so slash + emoji renderers share the same attach lifecycle. */
export function createSuggestionPositioner() {
  let stop: (() => void) | null = null
  return {
    attach(el: HTMLElement, getClientRect: (() => DOMRect | null) | null) {
      stop?.()
      stop = attachSuggestionPopupPosition(el, getClientRect)
    },
    detach() {
      stop?.()
      stop = null
    },
  }
}

/** Fixed, body-level container for a suggestion list positioned by clientRect. */
export function createSuggestionPopup(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.position = 'fixed'
  el.style.zIndex = '50'
  el.style.pointerEvents = 'auto'
  return markSuggestionPopup(el)
}
