/**
 * Authenticate a request to a /api/v1/admin/* endpoint.
 *
 * Auth is the simplest thing that works: a per-tenant
 * `ADMIN_API_TOKEN` env var, projected into the pod by whatever
 * deploy automation owns secret distribution. The request bearer
 * must match.
 *
 *   - env var unset                         → 404, endpoint "doesn't exist"
 *   - env var set + bearer matches          → null (caller proceeds)
 *   - env var set + bearer missing/wrong    → 401
 *
 * Operators that don't set the env var see admin endpoints as gone
 * to any external caller. The env var is opaque to the app — whoever
 * sets it is the implicit orchestrator.
 *
 * On success: returns null. On failure: returns a Response — the
 * handler should return it directly.
 */
export async function authenticateAdminToken(request: Request): Promise<Response | null> {
  const expected = process.env.ADMIN_API_TOKEN
  if (!expected) {
    return new Response('Not Found', { status: 404 })
  }

  const auth = request.headers.get('authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
  if (!bearer || !timingSafeStringEquals(bearer, expected)) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  return null
}

/**
 * Length-preserving constant-time string compare. Falls back to a
 * normal compare if lengths differ — leaking length is acceptable
 * (the env var is fixed-length per-tenant) and lets us avoid the
 * crypto buffer dance for what's a hot path on every admin call.
 */
function timingSafeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
