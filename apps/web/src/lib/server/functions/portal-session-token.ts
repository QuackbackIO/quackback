import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { config } from '@/lib/server/config'
import { readSessionCookie } from '@/lib/shared/auth-cookies'

/**
 * Extract the signed Better Auth session token from a cookie header string.
 *
 * The signed cookie value (UUID.HMAC) can be used directly as a Bearer token
 * by the widget iframe — the Better Auth bearer plugin accepts this format.
 * This enables the widget to reuse the portal's existing session instead of
 * creating a separate one.
 */
export function extractSessionTokenFromCookie(
  cookieHeader: string,
  cookiePrefix?: string
): string | null {
  return readSessionCookie(cookieHeader, cookiePrefix)
}

/** Extract the signed cookie for same-origin widget session reuse. */
export const getPortalSessionToken = createServerFn({ method: 'GET' }).handler(async () => {
  const cookie = getRequestHeaders().get('cookie') ?? ''
  return extractSessionTokenFromCookie(cookie, config.authCookiePrefix)
})
