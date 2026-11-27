/**
 * What the widget frame knows about its embedder and the visitor's portal
 * session, decided once in the browser.
 *
 * The server hands the frame a portal session only for a same-origin document
 * navigation, but a navigation the frame starts itself (a reload, a link
 * inside it) is same-origin whoever embeds the frame. The frame therefore
 * adopts that session only when its parent is readable and on its own origin,
 * or when it is the top page.
 *
 * The portal session cookie is SameSite=Lax, so the frame's own requests carry
 * it whenever the embedder is same-site. A frame that does not hold the portal
 * session must not act as it, so its server function calls go without
 * cookies (see serverFnFetch); the widget's own credential is its Bearer token.
 */

/** The parent window's origin when it is readable (same origin), else null. */
export function readableParentOrigin(): string | null {
  try {
    if (window.parent === window) return null
    return window.parent.location.origin
  } catch {
    return null
  }
}

/** Whether the page embedding this frame is on the frame's own origin (or there is none). */
export function frameParentIsSameOrigin(): boolean {
  if (typeof window === 'undefined') return false
  if (window.parent === window) return true
  return readableParentOrigin() === window.location.origin
}

type PortalSessionState = 'undecided' | 'held' | 'not-held'

let portalSessionState: PortalSessionState = 'undecided'

/** Record whether this widget frame holds the visitor's portal session. */
export function setFrameHoldsPortalSession(held: boolean): void {
  portalSessionState = held ? 'held' : 'not-held'
}

/** Whether this widget frame holds the visitor's portal session. */
export function frameHoldsPortalSession(): boolean {
  return portalSessionState === 'held'
}

/**
 * The credentials mode for this page's server function calls: 'omit' in a
 * widget frame that does not hold the portal session, else unchanged (pages
 * other than the widget never decide, and keep their cookies).
 */
export function frameRequestCredentials(): RequestCredentials | undefined {
  return portalSessionState === 'not-held' ? 'omit' : undefined
}

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
