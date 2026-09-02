// Editor suggestion popups (slash menu, emoji, mention) are portalled to
// <body>, outside the editor DOM. They carry this attribute so code that
// only sees the document — e.g. a global Escape handler — can tell whether
// a keypress was spent dismissing one.
export const SUGGESTION_POPUP_ATTR = 'data-editor-suggestion'

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
