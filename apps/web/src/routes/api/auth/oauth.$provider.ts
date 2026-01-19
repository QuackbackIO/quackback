import { createFileRoute } from '@tanstack/react-router'

/**
 * OIDC OAuth Initiation Route
 *
 * Initiates OAuth flow with tenant-configured OIDC providers. GitHub and Google
 * now use Better Auth's built-in socialProviders, so this route only handles OIDC.
 *
 * Query params:
 * - workspace: Workspace slug (required)
 * - returnDomain: Domain to redirect to after auth (required)
 * - callbackUrl: Path to redirect to after login (default: '/')
 * - type: 'portal' | 'team' - which OIDC config to use (default: 'portal')
 *
 * Flow:
 * 1. Validate workspace exists
 * 2. Load OIDC config from tenant settings (portal or team based on type)
 * 3. Build OIDC authorization URL with signed state
 * 4. Redirect to OIDC provider
 */

function buildOIDCCallbackUrl(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  const host = request.headers.get('host')
  return `${proto}://${host}/api/auth/callback/oidc`
}

export const Route = createFileRoute('/api/auth/oauth/$provider')({
  server: {
    handlers: {
      /**
       * GET /api/auth/oauth/[provider]
       * Initiate OAuth flow with OIDC provider
       *
       * Note: GitHub and Google now use Better Auth's built-in socialProviders.
       * This route only handles OIDC for tenant-configured identity providers.
       */
      GET: async ({ request, params }) => {
        const { db, settings, eq } = await import('@/lib/db')
        const { signOAuthState } = await import('@/lib/auth/oauth-state')

        const { provider } = params
        console.log(`[oauth] Initiating OAuth: provider=${provider}`)

        // Only OIDC is handled by this route
        // GitHub and Google use Better Auth's socialProviders (via authClient.signIn.social)
        if (provider !== 'oidc') {
          return Response.json(
            {
              error: `Provider '${provider}' should use Better Auth's signIn.social() instead`,
              hint: 'GitHub and Google OAuth is now handled by Better Auth socialProviders',
            },
            { status: 400 }
          )
        }

        const url = new URL(request.url)
        const searchParams = url.searchParams

        const orgSlug = searchParams.get('workspace')
        const returnDomain = searchParams.get('returnDomain')
        const callbackUrl = searchParams.get('callbackUrl') || '/'
        const popup = searchParams.get('popup') === 'true'
        const oidcType = (searchParams.get('type') || 'portal') as 'portal' | 'team'

        // Validate required params
        if (!orgSlug || !returnDomain) {
          return Response.json(
            { error: 'Missing required params: workspace, returnDomain' },
            { status: 400 }
          )
        }

        // Validate settings exists
        const org = await db.query.settings.findFirst({
          where: eq(settings.slug, orgSlug),
          columns: { id: true },
        })

        if (!org) {
          return Response.json({ error: 'Settings not found' }, { status: 404 })
        }

        // Load OIDC config from tenant settings (portal or team based on type)
        const { getFullOIDCConfig, getFullSecurityConfig } =
          await import('@/lib/settings/settings.service')
        const { buildOIDCAuthUrl } = await import('@/lib/auth/oidc.service')

        let oidcConfig
        if (oidcType === 'team') {
          // Team SSO - load from security config
          const securityConfig = await getFullSecurityConfig()
          if (!securityConfig?.sso.enabled || !securityConfig.sso.provider) {
            return Response.json(
              { error: 'Team SSO not configured for this workspace' },
              { status: 400 }
            )
          }
          oidcConfig = securityConfig.sso.provider
        } else {
          // Portal OIDC - load from portal config
          oidcConfig = await getFullOIDCConfig()
          if (!oidcConfig?.enabled) {
            return Response.json(
              { error: 'OIDC not configured for this workspace' },
              { status: 400 }
            )
          }
        }

        // Build state with workspace info (HMAC-signed to prevent tampering)
        const stateData = {
          workspace: orgSlug,
          returnDomain,
          callbackUrl,
          popup,
          type: oidcType,
          ts: Date.now(),
        }
        const signedState = signOAuthState(stateData)

        // Build OIDC authorization URL with callback to /api/auth/callback/oidc
        const oauthUrl = await buildOIDCAuthUrl(
          oidcConfig,
          buildOIDCCallbackUrl(request),
          `oidc:${signedState}`
        )

        console.log(`[oauth] ✅ Redirecting to OIDC provider`)
        return Response.redirect(oauthUrl, 302)
      },
    },
  },
})
