/**
 * Extract the signed Better Auth session token from a cookie header string.
 *
 * The signed cookie value (UUID.HMAC) can be used directly as a Bearer token
 * by the widget iframe — the Better Auth bearer plugin accepts this format.
 * This enables the widget to reuse the portal's existing session instead of
 * creating a separate one.
 */
export function extractSessionTokenFromCookie(cookieHeader: string): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split('=')
    // `__Secure-` prefixed on https.
    if (/^(?:__Secure-)?better-auth\.session_token$/.test(name?.trim() ?? '')) {
      const raw = valueParts.join('=') // rejoin in case value contains '='
      if (!raw) return null
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  }

  return null
}
