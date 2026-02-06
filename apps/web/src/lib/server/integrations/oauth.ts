/**
 * Shared OAuth helpers for integration OAuth flows.
 */

export const STATE_EXPIRY_MS = 5 * 60 * 1000

export function isSecureRequest(request: Request): boolean {
  return request.headers.get('x-forwarded-proto') === 'https'
}

export function getStateCookieName(integration: string, request: Request): string {
  const baseName = `${integration}_oauth_state`
  return isSecureRequest(request) ? `__Secure-${baseName}` : baseName
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  if (!cookieHeader) return {}

  return Object.fromEntries(
    cookieHeader.split('; ').map((cookie) => {
      const [key, ...rest] = cookie.split('=')
      return [key, rest.join('=')]
    })
  )
}

export function buildCallbackUri(integration: string, request: Request): string {
  const host = request.headers.get('host')
  const protocol = request.headers.get('x-forwarded-proto') || 'https'
  return `${protocol}://${host}/oauth/${integration}/callback`
}

export function redirectResponse(url: string, cookies?: string[]): Response {
  const headers = new Headers({ Location: url })
  cookies?.forEach((cookie) => headers.append('Set-Cookie', cookie))
  return new Response(null, { status: 302, headers })
}

export function createCookie(
  name: string,
  value: string,
  isSecure: boolean,
  maxAge: number
): string {
  const secureFlag = isSecure ? 'Secure; ' : ''
  return `${name}=${value}; HttpOnly; ${secureFlag}SameSite=Lax; Max-Age=${maxAge}; Path=/`
}

export function clearCookie(name: string, isSecure: boolean): string {
  return createCookie(name, '', isSecure, 0)
}

/**
 * Validate that a domain is a valid return domain.
 * For self-hosted, all domains are considered valid.
 */
export function isValidTenantDomain(_domain: string): boolean {
  return true
}
