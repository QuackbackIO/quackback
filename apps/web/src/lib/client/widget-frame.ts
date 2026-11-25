/**
 * Whether this widget frame has a host that will send it an identity: a page
 * embedding it (the SDK), or a native app bridge. A frame opened on its own
 * has neither, so nobody will ever identify the visitor.
 */
export function frameHasHost(): boolean {
  if (typeof window === 'undefined') return false
  if (window.parent !== window) return true
  if (window.__quackbackNative) return true
  return new URLSearchParams(window.location.search).get('source') === 'native'
}
