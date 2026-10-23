/** Better Auth's legacy namespace remains the default for existing deployments. */
export const DEFAULT_AUTH_COOKIE_PREFIX = 'better-auth'

export function sessionCookieNames(prefix = DEFAULT_AUTH_COOKIE_PREFIX) {
  return {
    secure: `__Secure-${prefix}.session_token`,
    plain: `${prefix}.session_token`,
  }
}

/**
 * Read only this deployment's session cookie. Never fall back to another
 * namespace: a parent-domain cookie may belong to an unrelated application.
 * Prefer HTTPS over HTTP, and keep the first value for a repeated name, as
 * Better Auth does. Signature verification remains the auth server's job.
 */
export function readSessionCookie(
  cookieHeader: string | null | undefined,
  prefix = DEFAULT_AUTH_COOKIE_PREFIX
): string | null {
  if (!cookieHeader) return null
  const names = sessionCookieNames(prefix)
  for (const wanted of [names.secure, names.plain]) {
    for (const part of cookieHeader.split(';')) {
      const equals = part.indexOf('=')
      if (equals < 0 || part.slice(0, equals).trim() !== wanted) continue
      const value = part.slice(equals + 1).trim()
      if (!value) return null
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
  }
  return null
}

export function hasSessionCookie(
  cookieHeader: string | null | undefined,
  prefix = DEFAULT_AUTH_COOKIE_PREFIX
): boolean {
  return readSessionCookie(cookieHeader, prefix) !== null
}
