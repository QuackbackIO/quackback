import { createFileRoute } from '@tanstack/react-router'

function getRedirectTarget(request: Request): string {
  const url = new URL(request.url)
  const redirectTo = url.searchParams.get('redirectTo') || url.searchParams.get('redirect_to')

  if (!redirectTo) {
    return '/'
  }

  try {
    const parsed = new URL(redirectTo, url.origin)
    if (parsed.origin !== url.origin) {
      return '/'
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/'
  }
}

function normalizeToken(rawToken: string): string {
  return rawToken
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim()
}

function logInvalidTokenShape(token: string): void {
  const partCount = token.split('.').length
  console.warn(
    `[taglyze-sso] invalid token shape: length=${token.length}, parts=${partCount}, startsWith=${token.slice(0, 8)}, endsWith=${token.slice(-8)}`
  )
}

export const Route = createFileRoute('/api/auth/taglyze-sso')({
  server: {
    handlers: {
      /**
       * GET /api/auth/taglyze-sso?token=<jwt>&redirectTo=/optional-path
       *
       * Validates a Taglyze-issued JWT, auto-provisions the user when needed,
       * signs the user in through Better Auth, and redirects with the Better Auth
       * session cookie set on the response.
       */
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const rawToken = url.searchParams.get('token')

        if (!rawToken) {
          return Response.json({ error: 'Missing token' }, { status: 400 })
        }

        const token = normalizeToken(rawToken)
        if (token.split('.').length !== 3) {
          logInvalidTokenShape(token)
          return Response.redirect('/auth/login?error=taglyze_sso_invalid_token', 302)
        }

        try {
          const { signInWithTaglyzeJwt } = await import(
            '@/lib/server/integrations/taglyze/taglyze-sso.service'
          )

          const result = await signInWithTaglyzeJwt({
            token,
            redirectTo: getRedirectTarget(request),
          })

          console.log(
            `[taglyze-sso] signed in user: taglyzeUserId=${result.taglyzeUserId}, email=${result.email}, created=${result.createdUser}`
          )

          return result.response
        } catch (error) {
          console.error('[taglyze-sso] failed:', error)
          return Response.redirect('/auth/login?error=taglyze_sso_failed', 302)
        }
      },
    },
  },
})
