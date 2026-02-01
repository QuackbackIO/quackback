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
  const appDomain = process.env.CLOUD_APP_DOMAIN
  if (appDomain) {
    return `https://${appDomain}/oauth/${integration}/callback`
  }

  const host = request.headers.get('host')
  const protocol = request.headers.get('x-forwarded-proto') || 'https'
  return `${protocol}://${host}/oauth/${integration}/callback`
}

export function redirectResponse(url: string, cookies?: string[]): Response {
  const headers = new Headers({ Location: url })
  cookies?.forEach((cookie) => headers.append('Set-Cookie', cookie))
  return new Response(null, { status: 302, headers })
}

function buildCookie(name: string, value: string, isSecure: boolean, maxAge: number): string {
  const secureFlag = isSecure ? 'Secure; ' : ''
  return `${name}=${value}; HttpOnly; ${secureFlag}SameSite=Lax; Max-Age=${maxAge}; Path=/`
}

export function createStateCookie(
  name: string,
  value: string,
  isSecure: boolean,
  maxAge: number
): string {
  return buildCookie(name, value, isSecure, maxAge)
}

export function clearCookie(name: string, isSecure: boolean): string {
  return buildCookie(name, '', isSecure, 0)
}

/**
 * Validate that a domain is a valid tenant subdomain.
 * Prevents open redirect attacks in cloud mode.
 */
export function isValidTenantDomain(domain: string): boolean {
  const baseDomain = process.env.CLOUD_TENANT_BASE_DOMAIN as string | undefined
  if (!baseDomain) return true

  const escapedBase = baseDomain.replace(/\./g, '\\.')
  const pattern = new RegExp(`^[a-z0-9][a-z0-9-]*\\.${escapedBase}$`, 'i')
  return pattern.test(domain)
}
