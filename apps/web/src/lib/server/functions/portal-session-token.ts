import { SESSION_TOKEN_COOKIE_NAME } from '@/lib/shared/auth-cookie'

/**
 * Extract the signed Better Auth session token from a cookie header string.
 *
 * The signed cookie value (UUID.HMAC) can be used directly as a Bearer token
 * by the widget iframe — the Better Auth bearer plugin accepts this format.
 * This enables the widget to reuse the portal's existing session instead of
 * creating a separate one.
 *
 * Matches both the http (`quackback.session_token`) and https
 * (`__Secure-quackback.session_token`) variants — Better-Auth picks
 * which one to set at runtime based on the resolved BASE_URL protocol,
 * so we accept whichever the browser is sending.
 */
export function extractSessionTokenFromCookie(cookieHeader: string): string | null {
  if (!cookieHeader) return null

  const secureName = `__Secure-${SESSION_TOKEN_COOKIE_NAME}`
  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split('=')
    const trimmedName = name?.trim()
    if (trimmedName === SESSION_TOKEN_COOKIE_NAME || trimmedName === secureName) {
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
