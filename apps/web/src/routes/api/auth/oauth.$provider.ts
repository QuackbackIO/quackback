import { createFileRoute } from '@tanstack/react-router'
import {
  buildCallbackUrl,
  isValidReturnDomain,
  isValidCallbackUrl,
  normalizeCallbackUrl,
  generateCodeVerifier,
  generateCodeChallenge,
  generateNonce,
} from '@/lib/auth/oauth-utils'

const OAUTH_PROVIDERS = {
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    scope: 'read:user user:email',
    extraParams: {},
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    scope: 'openid email profile',
    extraParams: { response_type: 'code', access_type: 'offline', prompt: 'select_account' },
  },
} as const

type OAuthProvider = keyof typeof OAUTH_PROVIDERS

function buildOAuthUrl(
  provider: OAuthProvider,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string
): string {
  const config = OAUTH_PROVIDERS[provider]
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: config.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...config.extraParams,
  })
  return `${config.authUrl}?${params}`
}

export const Route = createFileRoute('/api/auth/oauth/$provider')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { db, settings, eq } = await import('@/lib/db')
        const { signOAuthState, encryptOIDCConfig, encryptCodeVerifier } =
          await import('@/lib/auth/oauth-state')

        const { provider } = params
        console.log(`[oauth] Initiating OAuth: provider=${provider}`)

        const searchParams = new URL(request.url).searchParams
        const workspace = searchParams.get('workspace')
        const returnDomain = searchParams.get('returnDomain')
        const popup = searchParams.get('popup') === 'true'
        const oidcType = (searchParams.get('type') || 'portal') as 'portal' | 'team'

        if (!workspace || !returnDomain) {
          return Response.json(
            { error: 'Missing required params: workspace, returnDomain' },
            { status: 400 }
          )
        }

        if (!isValidReturnDomain(returnDomain, workspace)) {
          console.error(`[oauth] Invalid returnDomain: ${returnDomain} for workspace: ${workspace}`)
          return Response.json({ error: 'Invalid return domain' }, { status: 400 })
        }

        const rawCallbackUrl = searchParams.get('callbackUrl') || '/'
        if (!isValidCallbackUrl(rawCallbackUrl)) {
          console.error(`[oauth] Invalid callbackUrl: ${rawCallbackUrl}`)
          return Response.json({ error: 'Invalid callback URL' }, { status: 400 })
        }
        const safeCallbackUrl = normalizeCallbackUrl(rawCallbackUrl)

        const org = await db.query.settings.findFirst({
          where: eq(settings.slug, workspace),
          columns: { id: true },
        })

        if (!org) {
          return Response.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const baseState = {
          provider,
          workspace,
          returnDomain,
          callbackUrl: safeCallbackUrl,
          popup,
          type: oidcType,
        }

        // Handle GitHub and Google via shared config
        if (provider in OAUTH_PROVIDERS) {
          const oauthProvider = provider as OAuthProvider
          const config = OAUTH_PROVIDERS[oauthProvider]
          const clientId = process.env[config.clientIdEnv]

          if (!clientId) {
            return Response.json({ error: `${provider} OAuth not configured` }, { status: 400 })
          }

          const codeVerifier = generateCodeVerifier()
          const codeChallenge = generateCodeChallenge(codeVerifier)
          const encryptedVerifier = encryptCodeVerifier(codeVerifier)

          const signedState = signOAuthState({
            ...baseState,
            codeVerifier: encryptedVerifier,
            ts: Date.now(),
          })

          const redirectUri = buildCallbackUrl(request.headers, provider)
          console.log(`[oauth] Redirecting to ${provider}`)
          return Response.redirect(
            buildOAuthUrl(
              oauthProvider,
              clientId,
              redirectUri,
              `${provider}:${signedState}`,
              codeChallenge
            ),
            302
          )
        }

        // OIDC provider
        if (provider !== 'oidc') {
          return Response.json({ error: `Unsupported provider: ${provider}` }, { status: 400 })
        }

        const { getFullOIDCConfig, getFullSecurityConfig } =
          await import('@/lib/settings/settings.service')
        const { buildOIDCAuthUrl, decryptOIDCSecret } = await import('@/lib/auth/oidc.service')

        const oidcConfig =
          oidcType === 'team'
            ? (await getFullSecurityConfig())?.sso.provider
            : await getFullOIDCConfig()

        if (oidcType === 'team') {
          const securityConfig = await getFullSecurityConfig()
          if (!securityConfig?.sso.enabled || !securityConfig.sso.provider) {
            return Response.json(
              { error: 'Team SSO not configured for this workspace' },
              { status: 400 }
            )
          }
        } else if (!oidcConfig?.enabled) {
          return Response.json({ error: 'OIDC not configured for this workspace' }, { status: 400 })
        }

        if (!oidcConfig) {
          return Response.json({ error: 'OIDC configuration unavailable' }, { status: 400 })
        }

        const codeVerifier = generateCodeVerifier()
        const codeChallenge = generateCodeChallenge(codeVerifier)
        const encryptedVerifier = encryptCodeVerifier(codeVerifier)
        const nonce = generateNonce()

        const clientSecret = decryptOIDCSecret(oidcConfig.clientSecretEncrypted, org.id)
        const encryptedOidcConfig = encryptOIDCConfig({
          issuer: oidcConfig.issuer,
          clientId: oidcConfig.clientId,
          clientSecret,
          emailDomain: oidcConfig.emailDomain,
          scopes: oidcConfig.scopes,
          type: oidcType,
        })

        const oidcSignedState = signOAuthState({
          ...baseState,
          provider: 'oidc',
          oidcConfig: encryptedOidcConfig,
          codeVerifier: encryptedVerifier,
          nonce,
          ts: Date.now(),
        })

        const redirectUri = buildCallbackUrl(request.headers, 'oidc')
        const oauthUrl = await buildOIDCAuthUrl(
          oidcConfig,
          redirectUri,
          `oidc:${oidcSignedState}`,
          codeChallenge,
          nonce
        )
        console.log(`[oauth] Redirecting to OIDC provider`)
        return Response.redirect(oauthUrl, 302)
      },
    },
  },
})
