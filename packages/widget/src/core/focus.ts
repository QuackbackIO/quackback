/** Inputs that take a click or a choice rather than typed text. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** Whether the visitor is typing in this element. */
function isTypingTarget(el: Element): boolean {
  if (el instanceof HTMLElement && el.isContentEditable) return true
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type)
  return el.matches('textarea, select, [contenteditable]:not([contenteditable="false"])')
}

/**
 * Whether an open should move focus into the panel: the visitor asked for it
 * with a click or key press, and is not typing in a field. Where the browser
 * reports that activation, a timed or route-driven open leaves focus alone.
 * Elsewhere, an open counts as asked for when nothing, a button or a link
 * (the host page's own help button) has focus.
 */
export function openerWantsFocusMoved(active: Element | null): boolean {
  const typing = !!active && active !== document.body && isTypingTarget(active)
  const activation = (navigator as { userActivation?: { isActive: boolean } }).userActivation
  if (activation) return activation.isActive && !typing
  if (!active || active === document.body) return true
  if (typing) return false
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
