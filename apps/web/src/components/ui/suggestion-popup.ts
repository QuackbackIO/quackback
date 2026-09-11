import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'

// Editor suggestion popups (slash menu, emoji, mention) are portalled to
// <body>, outside the editor DOM. They carry this attribute so code that
// only sees the document — e.g. a global Escape handler — can tell whether
// a keypress was spent dismissing one.
export const SUGGESTION_POPUP_ATTR = 'data-editor-suggestion'

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

export function markSuggestionPopup<T extends Element>(el: T): T {
  el.setAttribute(SUGGESTION_POPUP_ATTR, '')
  return el
}

/** Fixed, body-level container for a suggestion list positioned by clientRect. */
export function createSuggestionPopup(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.position = 'fixed'
  el.style.zIndex = '50'
  el.style.pointerEvents = 'auto'
  return markSuggestionPopup(el)
}

/**
 * True when a suggestion popup is actually showing. Presence in the DOM is
 * not enough: the mention popup is a tippy instance whose `hide()` can leave
 * the marked element mounted (hidden) for a beat, and any renderer may keep
 * a hidden element around — a stale marker would make every Escape look like
 * a dismissal and trap focus in the composer.
 */
export function hasOpenSuggestionPopup(): boolean {
  const popups = document.querySelectorAll<HTMLElement>(`[${SUGGESTION_POPUP_ATTR}]`)
  return Array.from(popups).some((el) =>
    typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
      : el.getClientRects().length > 0
  )
}
