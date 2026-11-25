interface NativeBridge {
  dispatch: (event: string, data: unknown) => void
}

declare global {
  interface Window {
    __quackbackNative?: Partial<NativeBridge>
  }
}

/** The http(s) origin of `value`, or null for anything else (including the opaque 'null'). */
function httpOrigin(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * The origin of the page embedding the widget frame: the first ancestor
 * origin where the browser exposes it, else the origin of the document
 * referrer. Null when neither gives an http(s) origin, as for a sandboxed
 * embedder or a host page that sends no referrer.
 */
export function resolveHostOrigin(source: {
  ancestorOrigins?: ArrayLike<string> | null
  referrer?: string | null
}): string | null {
  const ancestor = source.ancestorOrigins?.length ? source.ancestorOrigins[0] : null
  if (ancestor) return httpOrigin(ancestor)
  return httpOrigin(source.referrer)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Whether a navigate message's URL carries a one-time sign-in token (the portal handoff). */
function carriesSignInToken(message: Record<string, unknown>): boolean {
  if (message.type !== 'quackback:navigate' || typeof message.url !== 'string') return false
  try {
    return new URL(message.url).searchParams.has('ott')
  } catch {
    return false
  }
}

/**
 * Whether a message names the signed-in user or signs them in: identify
 * results, auth changes, events whose payload carries a user, and the portal
 * handoff link. Results with no user (anonymous or failed) carry nothing
 * personal.
 */
export function carriesUserData(message: Record<string, unknown>): boolean {
  if (isRecord(message.user)) return true
  if (isRecord(message.payload) && isRecord(message.payload.user)) return true
  return carriesSignInToken(message)
}

let cachedHostOrigin: string | null | undefined

function hostOrigin(): string | null {
  if (cachedHostOrigin === undefined) {
    cachedHostOrigin = resolveHostOrigin({
      ancestorOrigins: window.location.ancestorOrigins,
      referrer: document.referrer,
    })
  }
  return cachedHostOrigin
}

/**
 * Post a message to the page hosting the widget, addressed to that page's
 * origin rather than to any origin. When the host origin is unknown, messages
 * without user data still go out to any origin, and messages naming the user
 * are not sent.
 */
export function sendToHost(message: Record<string, unknown>): void {
  if (window.__quackbackNative?.dispatch) {
    const rawType = typeof message.type === 'string' ? message.type : ''
    const eventType = rawType.startsWith('quackback:')
      ? rawType.slice('quackback:'.length)
      : rawType || 'unknown'
    window.__quackbackNative.dispatch(eventType, message)
    return
  }
  const origin = hostOrigin()
  if (origin) {
    window.parent.postMessage(message, origin)
    return
  }
  if (carriesUserData(message)) return
  window.parent.postMessage(message, '*')
}

export function isNativeWidget(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('source') === 'native'
}
