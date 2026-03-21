import { createFileRoute } from '@tanstack/react-router'

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

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      /**
       * GET /api/auth/*
       * Better-auth catch-all route handler
       */
      GET: async ({ request }) => {
        const { auth } = await import('@/lib/server/auth/index')
        return await auth.handler(request)
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
        return await auth.handler(request)
      },
    },
  },
})
