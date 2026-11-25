/** Whether the visitor is typing in this element. */
function isTypingTarget(el: Element): boolean {
  if (el instanceof HTMLElement && el.isContentEditable) return true
  return el.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}

/**
 * Whether an open with this element focused came from the visitor asking for
 * the panel, so focus should move into it: nothing focused, or a button or
 * link (the host page's own help button). An open while the visitor types in
 * a field (a timer, a deep link) leaves their focus where it is.
 */
export function openerWantsFocusMoved(active: Element | null): boolean {
  if (!active || active === document.body) return true
  if (isTypingTarget(active)) return false
  return active.matches('button, a[href], [role="button"], [role="link"], summary')
}

/**
 * Whether focus can go back to this element: still on the page, not
 * disabled, and not hidden by it or an ancestor.
 */
export function canRestoreFocus(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected || el === document.body) return false
  if ((el as HTMLButtonElement).disabled) return false
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden) return false
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}
