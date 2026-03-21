/**
 * Widget auth utilities for cross-origin iframe contexts.
 *
 * The widget iframe can't set cookies (SameSite=Lax blocks them in cross-origin iframes).
 * Instead, we store session tokens in-memory and inject them as Bearer headers into
 * server function calls. identify() is called on every page load so cross-reload
 * persistence is not needed. The Better Auth bearer plugin on the server converts
 * these headers back to session lookups transparently.
 */

let _widgetToken: string | null = null

export function setWidgetToken(token: string): void {
  _widgetToken = token
}

export function getWidgetToken(): string | null {
  return _widgetToken
}

export function clearWidgetToken(): void {
  _widgetToken = null
}

export function hasWidgetToken(): boolean {
  return _widgetToken !== null
}

/**
 * Get auth headers for widget server function calls.
 * Returns Authorization: Bearer header if a token exists, empty object otherwise.
 */
export function getWidgetAuthHeaders(): Record<string, string> {
  const token = getWidgetToken()
  if (token) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
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
