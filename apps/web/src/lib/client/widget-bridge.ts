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
 * The origin of the page embedding the widget frame as the frame itself can
 * see it: the first ancestor origin where the browser exposes it, else the
 * origin of the document referrer. A referrer on the frame's own origin is
 * ignored, since a navigation started inside the frame leaves the frame's own
 * URL there. Null when neither gives an http(s) origin.
 */
export function resolveHostOrigin(source: {
  ancestorOrigins?: ArrayLike<string> | null
  referrer?: string | null
  ownOrigin?: string | null
}): string | null {
  const ancestor = source.ancestorOrigins?.length ? source.ancestorOrigins[0] : null
  if (ancestor) return httpOrigin(ancestor)
  const referrerOrigin = httpOrigin(source.referrer)
  if (referrerOrigin && referrerOrigin === source.ownOrigin) return null
  return referrerOrigin
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
 * Whether a message carries anything about the visitor: a signed-in user
 * (identify results, auth changes), any widget event (they carry what the
 * visitor wrote or did), or the portal handoff link with its one-time sign-in
 * token. Results with no user (anonymous or failed) carry nothing personal.
 */
export function carriesUserData(message: Record<string, unknown>): boolean {
  if (isRecord(message.user)) return true
  if (message.type === 'quackback:event') return true
  return carriesSignInToken(message)
}

/**
 * What the frame knows about the host's origin from the host's own messages.
 * `opaque` is a host whose messages arrive from the 'null' origin (a
 * sandboxed page): no targeted message can ever reach it.
 */
type RememberedOrigin = { kind: 'unknown' } | { kind: 'known'; origin: string } | { kind: 'opaque' }

let remembered: RememberedOrigin = { kind: 'unknown' }
let cachedFallbackOrigin: string | null | undefined
/** Messages with user data held back until the host origin is known. */
let pending: Record<string, unknown>[] = []
const MAX_PENDING = 50

function fallbackOrigin(): string | null {
  if (cachedFallbackOrigin === undefined) {
    cachedFallbackOrigin = resolveHostOrigin({
      ancestorOrigins: window.location.ancestorOrigins,
      referrer: document.referrer,
      ownOrigin: window.location.origin,
    })
  }
  return cachedFallbackOrigin
}

function targetOrigin(): RememberedOrigin {
  if (remembered.kind !== 'unknown') return remembered
  const origin = fallbackOrigin()
  return origin ? { kind: 'known', origin } : { kind: 'unknown' }
}

function deliverUserData(message: Record<string, unknown>): void {
  const target = targetOrigin()
  if (target.kind === 'known') {
    window.parent.postMessage(message, target.origin)
    return
  }
  if (target.kind === 'opaque') {
    // The host can never receive a targeted message. An identify still gets
    // a reply, without the user, so the host is not left waiting.
    if (message.type === 'quackback:identify-result') {
      window.parent.postMessage(
        { type: 'quackback:identify-result', success: false, error: 'HOST_ORIGIN_UNKNOWN' },
        '*'
      )
    }
    return
  }
  if (pending.length < MAX_PENDING) pending.push(message)
}

/**
 * Record the host page's origin from a message it posted to this frame. The
 * browser sets `event.origin`, so the first message from the parent window
 * names the host origin even where the frame cannot see its ancestors or a
 * referrer. Messages from any other window are ignored. Messages held back
 * while the origin was unknown go out, in order, once it is recorded.
 */
export function rememberHostOrigin(event: MessageEvent): void {
  if (remembered.kind !== 'unknown' || typeof window === 'undefined') return
  if (event.source !== window.parent || window.parent === window) return
  const origin = httpOrigin(event.origin)
  remembered = origin ? { kind: 'known', origin } : { kind: 'opaque' }
  const held = pending
  pending = []
  for (const message of held) deliverUserData(message)
}

// Listen from module load, before any reader: the host's first message (its
// init, or an identify) arrives before the frame replies to anything, and this
// listener runs ahead of the ones that reply.
if (typeof window !== 'undefined') {
  window.addEventListener('message', rememberHostOrigin)
}

/**
 * Post a message to the page hosting the widget.
 *
 * Messages without user data (ready, close, unread counts, expand, plain
 * links) go to any origin: they carry nothing personal, and the handshake
 * must reach the host whatever its origin turns out to be. Messages with
 * user data go only to the host's origin: the origin of the host's own
 * messages to the frame, else the first ancestor origin, else the referrer
 * origin. While none is known they are held back and sent once the host's
 * first message names its origin. A host on an opaque origin gets no user
 * data; its identify gets a HOST_ORIGIN_UNKNOWN failure instead.
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
  if (!carriesUserData(message)) {
    window.parent.postMessage(message, '*')
    return
  }
  deliverUserData(message)
}

export function isNativeWidget(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('source') === 'native'
}
