/**
 * CORS for the MCP endpoint and the public OAuth surfaces MCP clients use.
 *
 * Browser-hosted MCP clients run discovery, dynamic registration, the token
 * exchange and MCP calls with `fetch` from their own origin. Every one of
 * these is authorized by a bearer token or PKCE, never by cookies, so the
 * policy is `*` with no credentials. Cookie-authed endpoints (sign-in,
 * session, authorize, consent) are deliberately not listed.
 */
import { createMiddleware } from '@tanstack/react-start'

const EXACT_PATHS = new Set([
  '/api/mcp',
  '/api/auth/oauth2/register',
  '/api/auth/oauth2/token',
  '/api/auth/oauth2/revoke',
  '/api/auth/jwks',
])

const WELL_KNOWN_PREFIXES = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
  '/api/auth/.well-known/',
]

export function isOAuthCorsPath(pathname: string): boolean {
  if (EXACT_PATHS.has(pathname)) return true
  return WELL_KNOWN_PREFIXES.some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
  )
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID, DPoP',
  'Access-Control-Expose-Headers':
    'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version, DPoP-Nonce',
  'Access-Control-Max-Age': '86400',
}

interface NextResult {
  response?: Response
}

export async function handleOAuthCors<T extends NextResult>({
  request,
  next,
}: {
  request: Request
  next: () => Promise<T>
}): Promise<T | Response> {
  if (!isOAuthCorsPath(new URL(request.url).pathname)) return next()
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS })

  const result = await next()
  const response = result.response
  if (!response) return result
  try {
    for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value)
  } catch {
    // Redirects and some fetch-derived responses have immutable headers.
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value)
    result.response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
  return result
}

export const oauthCorsMiddleware = createMiddleware().server(({ next, request }) =>
  handleOAuthCors({ request, next: () => Promise.resolve(next()) })
)
