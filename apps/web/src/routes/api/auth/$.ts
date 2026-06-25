import { createFileRoute } from '@tanstack/react-router'
import { SSO_OAUTH_CALLBACK_PATH } from '@/lib/shared/sso-test-keys'
import { rewriteUrlToPublicBaseUrl } from '@/lib/server/public-url'
import { SSO_OAUTH_CALLBACK_PREFIX } from '@/lib/shared/sso-test-keys'

/**
 * Simple rate limiter for OAuth client registration.
 * Limits to 10 registrations per IP per hour to prevent spam/abuse.
 */
const registrationAttempts = new Map<string, { count: number; windowStart: number }>()
const REG_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const REG_MAX = 10

function isRegistrationRateLimited(request: Request): boolean {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  const now = Date.now()
  const entry = registrationAttempts.get(ip)

  if (!entry || now - entry.windowStart > REG_WINDOW_MS) {
    registrationAttempts.set(ip, { count: 1, windowStart: now })
    return false
  }

  entry.count++
  return entry.count > REG_MAX
}

/**
 * Rewrite localhost redirects to use the public origin from forwarded
 * headers. When accessed via a tunnel (Cloudflare, ngrok, etc), Better Auth
 * may redirect to the configured localhost baseUrl instead of the actual
 * public origin where the request came from.
 */
async function rewriteAuthRedirect(response: Response, request: Request): Promise<Response> {
  // Only handle redirect responses
  const status = response.status
  if (status < 300 || status >= 400) {
    return response
  }

  const location = response.headers.get('location')
  if (!location) {
    return response
  }

  // Rewrite localhost URLs to use public origin
  const rewritten = rewriteUrlToPublicBaseUrl(location, request.headers)
  if (rewritten !== location) {
    // Clone the response and update the Location header
    const newResponse = new Response(response.body, response)
    newResponse.headers.set('location', rewritten)
    return newResponse
  }

  return response
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      /**
       * GET /api/auth/* — Better-Auth catch-all. Intercepts the SSO
       * callback for admin Test sign-in (state-keyed dispatch in
       * `handleSsoTestCallback`); everything else delegates.
       */
      GET: async ({ request }) => {
        const url = new URL(request.url)
        // Intercept any genericOAuth callback before Better-Auth: a hit on
        // `sso-test:<state>` in Redis means this is an admin test sign-in;
        // a miss returns null and falls through to the real OAuth handler.
        if (url.pathname.startsWith(SSO_OAUTH_CALLBACK_PREFIX)) {
          const { handleSsoTestCallback, renderSsoTestCallbackHtml } =
            await import('@/lib/server/auth/sso-test-callback')
          const handled = await handleSsoTestCallback({
            state: url.searchParams.get('state'),
            code: url.searchParams.get('code'),
            error: url.searchParams.get('error'),
            errorDescription: url.searchParams.get('error_description'),
          })
          if (handled) {
            return renderSsoTestCallbackHtml({
              testId: handled.testId,
              result: handled.result,
              origin: url.origin,
              identityMatched: handled.identityMatched,
            })
          }
        }

        const { auth } = await import('@/lib/server/auth/index')
        let response = await auth.handler(request)
        response = await rewriteAuthRedirect(response, request)
        return response
      },

      /**
       * POST /api/auth/*
       * Better-auth catch-all route handler
       */
      POST: async ({ request }) => {
        const url = new URL(request.url)

        // Rate-limit OAuth dynamic client registration to prevent spam/phishing
        if (url.pathname.endsWith('/oauth2/register')) {
          if (isRegistrationRateLimited(request)) {
            return Response.json(
              { error: 'Too many client registrations. Try again later.' },
              { status: 429 }
            )
          }
        }

        // Ensure `resource` is present in token exchange requests.
        // Without it, better-auth issues opaque tokens instead of JWTs,
        // breaking `verifyAccessToken` in the MCP handler.
        // Reading the body consumes the stream, so we always reconstruct
        // the request to avoid passing a consumed body to better-auth.
        if (url.pathname.endsWith('/oauth2/token')) {
          const contentType = request.headers.get('content-type') ?? ''
          if (contentType.includes('application/x-www-form-urlencoded')) {
            const body = await request.text()
            const params = new URLSearchParams(body)
            if (!params.has('resource')) {
              const { config } = await import('@/lib/server/config')
              params.set('resource', `${config.baseUrl}/api/mcp`)
            }
            request = new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: params.toString(),
            })
          }
        }

        const { auth } = await import('@/lib/server/auth/index')
        let response = await auth.handler(request)
        response = await rewriteAuthRedirect(response, request)
        return response
      },
    },
  },
})
