/**
 * Better Auth 1.7 serves generic OAuth on `/api/auth/callback/:id`.
 * Customers already registered `/api/auth/oauth2/callback/:id` at their IdP.
 * Rewrite the request URL so both paths hit the same handler.
 */
const LEGACY_PREFIX = '/api/auth/oauth2/callback/'
const CURRENT_PREFIX = '/api/auth/callback/'

export function rewriteLegacyOAuthCallback(request: Request): Request {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(LEGACY_PREFIX)) return request
  url.pathname = `${CURRENT_PREFIX}${url.pathname.slice(LEGACY_PREFIX.length)}`
  return new Request(url, request)
}
