import { createFileRoute } from '@tanstack/react-router'
import { db, settings, eq } from '@/lib/db'
import { signOAuthState } from '@/lib/auth/oauth-state'

/**
 * OAuth Initiation Route
 *
 * Initiates OAuth flow with GitHub or Google. All OAuth flows happen on the
 * main domain to use a single callback URL registered with providers.
 *
 * Query params:
 * - workspace: Workspace slug (required)
 * - returnDomain: Domain to redirect to after auth (required)
 * - context: 'team' or 'portal' (default: 'portal')
 * - callbackUrl: Path to redirect to after login (default: '/')
 *
 * Flow:
 * 1. Validate workspace exists
 * 2. Build OAuth URL with state containing org + returnDomain
 * 3. Redirect to OAuth provider
 */

interface OAuthConfig {
  authUrl: string
  clientId: string
  scope: string
}

const OAUTH_CONFIGS: Record<string, OAuthConfig | undefined> = {
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    clientId: process.env.GITHUB_CLIENT_ID || '',
    scope: 'read:user user:email',
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    scope: 'openid email profile',
  },
}

function buildCallbackUrl(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  const host = request.headers.get('host')
  return `${proto}://${host}/api/auth/oauth-callback`
}

export const Route = createFileRoute('/api/auth/oauth/$provider')({
  server: {
    handlers: {
      /**
       * GET /api/auth/oauth/[provider]
       * Initiate OAuth flow with provider
       */
      GET: async ({ request, params }) => {
        const { provider } = params
        const url = new URL(request.url)
        const searchParams = url.searchParams

        const orgSlug = searchParams.get('workspace')
        const returnDomain = searchParams.get('returnDomain')
        const context = searchParams.get('context') || 'portal'
        const callbackUrl = searchParams.get('callbackUrl') || '/'
        const popup = searchParams.get('popup') === 'true'

        // Validate required params
        if (!orgSlug || !returnDomain) {
          return Response.json(
            { error: 'Missing required params: workspace, returnDomain' },
            { status: 400 }
          )
        }

        // Validate provider
        const config = OAUTH_CONFIGS[provider]
        if (!config) {
          return Response.json({ error: 'Invalid OAuth provider' }, { status: 400 })
        }

        if (!config.clientId) {
          return Response.json({ error: `${provider} OAuth is not configured` }, { status: 500 })
        }

        // Validate settings exists
        const org = await db.query.settings.findFirst({
          where: eq(settings.slug, orgSlug),
          columns: { id: true },
        })

        if (!org) {
          return Response.json({ error: 'Settings not found' }, { status: 404 })
        }

        // Build state with workspace info (HMAC-signed to prevent tampering)
        const stateData = {
          workspace: orgSlug,
          returnDomain,
          context,
          callbackUrl,
          popup,
          ts: Date.now(), // Prevent replay attacks
        }
        const signedState = signOAuthState(stateData)

        // Build OAuth URL
        const oauthUrl = new URL(config.authUrl)
        oauthUrl.searchParams.set('client_id', config.clientId)
        oauthUrl.searchParams.set('redirect_uri', buildCallbackUrl(request))
        oauthUrl.searchParams.set('scope', config.scope)
        oauthUrl.searchParams.set('state', `${provider}:${signedState}`)

        // Provider-specific params
        if (provider === 'google') {
          oauthUrl.searchParams.set('response_type', 'code')
          oauthUrl.searchParams.set('access_type', 'offline')
          oauthUrl.searchParams.set('prompt', 'select_account')
        }

        return Response.redirect(oauthUrl.toString(), 302)
      },
    },
  },
})
