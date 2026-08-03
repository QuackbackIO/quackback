/**
 * Widget auth utilities for cross-origin iframe contexts.
 *
 * The widget iframe can't set cookies (SameSite=Lax blocks them in cross-origin iframes).
 * Instead, we store session tokens in-memory and inject them as Bearer headers into
 * server function calls. The Better Auth bearer plugin on the server converts these
 * headers back to session lookups transparently.
 *
 * Identified/portal tokens stay in-memory only (re-established on each load via the
 * SDK identify call or portal-session passthrough). ANONYMOUS tokens are additionally
 * persisted to the iframe-origin localStorage (see persistAnonymousToken) so a
 * visitor's conversation survives reloads / new tabs / return visits. Persisting only
 * anonymous tokens keeps the XSS blast radius to anonymous-tier access.
 */

// Namespaced by the widget iframe's own origin (always the Quackback instance —
// first-party even when embedded cross-site), so multiple tenants on one host
// page can't collide.
const ANON_TOKEN_KEY_PREFIX = 'quackback:anon-token:'
// Mirror Better Auth's 7-day session TTL so an expired token is dropped
// client-side instead of triggering a guaranteed-401 validation round-trip.
const ANON_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function anonTokenStore(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

function anonTokenKey(): string {
  return `${ANON_TOKEN_KEY_PREFIX}${window.location.origin}`
}

let _widgetToken: string | null = null
let _widgetContextToken: string | null = null

export function setWidgetToken(token: string): void {
  _widgetToken = token
}

export function getWidgetToken(): string | null {
  return _widgetToken
}

export function setWidgetContextToken(token: string | null | undefined): void {
  _widgetContextToken = token ?? null
}

export function getWidgetContextToken(): string | null {
  return _widgetContextToken
}

/** Clears the in-memory token AND any persisted anonymous copy. */
export function clearWidgetToken(): void {
  _widgetToken = null
  clearPersistedToken()
}

/**
 * Persist an ANONYMOUS session token to the widget iframe's first-party
 * localStorage so it survives reloads. Only ever call this for anonymous
 * tokens — never identified/portal tokens. Stored with a 7-day expiry hint.
 * Does not touch the in-memory token. Degrades to a no-op when storage is
 * unavailable (SSR / private mode / quota).
 */
export function persistAnonymousToken(token: string): void {
  const store = anonTokenStore()
  if (!store) return
  try {
    store.setItem(
      anonTokenKey(),
      JSON.stringify({ token, expiresAt: Date.now() + ANON_TOKEN_TTL_MS })
    )
  } catch {
    // Storage disabled or full — fall back to in-memory only.
  }
}

/**
 * Read a previously persisted anonymous token. Returns null (and drops the
 * entry) when missing, malformed, or past its expiry hint. Does not set the
 * in-memory token — the caller validates it server-side before adopting it.
 */
export function readPersistedToken(): string | null {
  const store = anonTokenStore()
  if (!store) return null
  const key = anonTokenKey()
  let raw: string | null
  try {
    raw = store.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown }
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= Date.now()
    ) {
      store.removeItem(key)
      return null
    }
    return parsed.token
  } catch {
    try {
      store.removeItem(key)
    } catch {
      // ignore
    }
    return null
  }
}

/** Remove only the persisted anonymous token, leaving the in-memory token intact. */
export function clearPersistedToken(): void {
  const store = anonTokenStore()
  if (!store) return
  try {
    store.removeItem(anonTokenKey())
  } catch {
    // ignore
  }
}

export function hasWidgetToken(): boolean {
  return _widgetToken !== null
}

/**
 * Get auth headers for widget server function calls.
 * Returns Authorization: Bearer header if a token exists, empty object otherwise.
 */
export function getWidgetAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = getWidgetToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const contextToken = getWidgetContextToken()
  if (contextToken) {
    headers['X-Quackback-Widget-Context'] = contextToken
  }
  return headers
}

/**
 * Generate a one-time token for transferring the widget session to the portal.
 * The OTT can be appended to a portal URL as `?ott=<token>` — the portal
 * verifies it and sets a session cookie, giving the user a seamless transition.
 */
export async function generateOneTimeToken(): Promise<string | null> {
  const token = getWidgetToken()
  if (!token) return null

  try {
    const res = await fetch('/api/auth/one-time-token/generate', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      console.error(
        '[widget-auth] OTT generate failed:',
        res.status,
        await res.text().catch(() => '')
      )
      return null
    }
    const data = await res.json()
    return data.token ?? null
  } catch (err) {
    console.error('[widget-auth] OTT generate error:', err)
    return null
  }
}
