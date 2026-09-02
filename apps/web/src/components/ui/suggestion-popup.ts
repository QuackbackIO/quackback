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

export function hasOpenSuggestionPopup(): boolean {
  return document.querySelector(`[${SUGGESTION_POPUP_ATTR}]`) !== null
}
