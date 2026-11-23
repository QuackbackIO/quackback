/**
 * CORS helpers for integration app API endpoints.
 *
 * These endpoints are called from iframes hosted on external domains
 * (e.g. Zendesk agent interface, Intercom messenger), so they need permissive CORS headers.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

export function corsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS, 'Cache-Control': 'no-store, private' }
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

/**
 * Add the CORS headers to a response built elsewhere (an error from
 * handleDomainError or badRequestResponse), keeping its own headers. Without
 * them the browser hides an error's status and body from the app.
 */
export function withCors(response: Response): Response {
  for (const [name, value] of Object.entries(corsHeaders())) response.headers.set(name, value)
  return response
}

/** Create a JSON response with CORS headers. Used by all /api/v1/apps/* routes. */
export function appJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}
