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
        const token = url.searchParams.get('token')

        if (!token) {
          return Response.json({ error: 'Missing token' }, { status: 400 })
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
