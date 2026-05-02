import { verifyApiKeyWithScope } from './api-key.service'
import type { ApiKey } from './api-key.types'

/**
 * Authenticate a request to a /api/v1/internal/* endpoint.
 *
 * On success: returns the verified ApiKey.
 * On failure: returns a Response (401 unauth, 403 forbidden) — the
 * handler should return it directly.
 *
 * Used by both /api/v1/internal/tier-limits and /api/v1/internal/usage.
 * Any future internal endpoint should call this rather than re-implementing
 * the bearer parse + scope check.
 */
export async function authenticateInternal(
  request: Request,
  scope: string
): Promise<ApiKey | Response> {
  const auth = request.headers.get('authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
  if (!bearer) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const key = await verifyApiKeyWithScope(bearer, scope)
  if (!key) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }
  return key
}
