/**
 * OAuth Callback Plugin for Better-Auth
 *
 * Handles OAuth callbacks from GitHub, Google, and OIDC providers on the app domain.
 * Since the app domain doesn't have tenant context, this plugin:
 * 1. Verifies the HMAC-signed state (contains workspace info)
 * 2. Exchanges the authorization code for tokens
 * 3. Fetches user info from the OAuth provider
 * 4. Creates a signed JWT with user info
 * 5. Redirects to the tenant domain to complete authentication
 */

import { createAuthEndpoint } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { z } from 'zod'
import { SignJWT } from 'jose'
import {
  type OAuthState,
  type OIDCOAuthState,
  type OAuthUserInfo,
  buildCallbackUrl,
  buildErrorRedirect,
  buildCompletionUrl,
  buildDisplayName,
  isStateExpired,
} from '@/lib/auth/oauth-utils'
import { verifyOAuthState, decryptOIDCConfig, decryptCodeVerifier } from '@/lib/auth/oauth-state'

interface OAuthProviderConfig {
  exchangeCode: (code: string, redirectUri: string, codeVerifier: string) => Promise<string>
  getUserInfo: (accessToken: string) => Promise<OAuthUserInfo>
}

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  github: {
    exchangeCode: async (code, redirectUri, codeVerifier) => {
      const clientId = process.env.GITHUB_CLIENT_ID
      const clientSecret = process.env.GITHUB_CLIENT_SECRET
      if (!clientId || !clientSecret) throw new Error('GitHub OAuth not configured')

      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      })

      if (!response.ok) throw new Error(`GitHub token exchange failed: ${response.status}`)
      const data = (await response.json()) as { access_token?: string; error?: string }
      if (data.error || !data.access_token) throw new Error(`GitHub error: ${data.error}`)
      return data.access_token
    },
    getUserInfo: async (accessToken) => {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'Quackback',
      }

      const userResponse = await fetch('https://api.github.com/user', { headers })
      if (!userResponse.ok) throw new Error(`GitHub user fetch failed: ${userResponse.status}`)

      const user = (await userResponse.json()) as {
        id: number
        login: string
        name: string | null
        email: string | null
        avatar_url: string | null
      }

      let email = user.email
      if (!email) {
        const emailsResponse = await fetch('https://api.github.com/user/emails', { headers })
        if (emailsResponse.ok) {
          const emails = (await emailsResponse.json()) as Array<{
            email: string
            primary: boolean
            verified: boolean
          }>
          const primaryEmail = emails.find((e) => e.primary && e.verified)
          email = primaryEmail?.email || emails[0]?.email || null
        }
      }

      if (!email) throw new Error('Unable to get email from GitHub')
      return {
        email,
        name: user.name || user.login,
        image: user.avatar_url,
        providerId: String(user.id),
      }
    },
  },
  google: {
    exchangeCode: async (code, redirectUri, codeVerifier) => {
      const clientId = process.env.GOOGLE_CLIENT_ID
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET
      if (!clientId || !clientSecret) throw new Error('Google OAuth not configured')

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Google token exchange failed: ${response.status} - ${error}`)
      }
      const data = (await response.json()) as { access_token?: string; error?: string }
      if (data.error || !data.access_token) throw new Error(`Google error: ${data.error}`)
      return data.access_token
    },
    getUserInfo: async (accessToken) => {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) throw new Error(`Google userinfo failed: ${response.status}`)

      const user = (await response.json()) as {
        id: string
        email: string
        name: string
        picture: string | null
      }

      if (!user.email) throw new Error('Unable to get email from Google')
      return {
        email: user.email,
        name: user.name,
        image: user.picture,
        providerId: user.id,
      }
    },
  },
}

async function fetchOIDCDiscovery(
  issuer: string
): Promise<{ tokenEndpoint: string; userinfoEndpoint: string }> {
  const normalizedIssuer = issuer.replace(/\/$/, '')
  const response = await fetch(`${normalizedIssuer}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) throw new Error(`OIDC discovery failed: ${response.status}`)

  const metadata = (await response.json()) as {
    token_endpoint?: string
    userinfo_endpoint?: string
  }

  if (!metadata.token_endpoint || !metadata.userinfo_endpoint) {
    throw new Error('OIDC discovery missing required endpoints')
  }

  return {
    tokenEndpoint: metadata.token_endpoint,
    userinfoEndpoint: metadata.userinfo_endpoint,
  }
}

async function exchangeOIDCCode(
  issuer: string,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<string> {
  const discovery = await fetchOIDCDiscovery(issuer)

  const response = await fetch(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  })

  const data = (await response.json()) as {
    error?: string
    error_description?: string
    access_token?: string
  }

  if (data.error || !data.access_token) {
    throw new Error(`OIDC token exchange error: ${data.error_description || data.error}`)
  }

  return data.access_token
}

async function getOIDCUserInfo(issuer: string, accessToken: string): Promise<OAuthUserInfo> {
  const discovery = await fetchOIDCDiscovery(issuer)

  const response = await fetch(discovery.userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })

  if (!response.ok) throw new Error(`OIDC userinfo failed: ${response.status}`)

  const data = (await response.json()) as {
    sub?: string
    email?: string
    name?: string
    given_name?: string
    family_name?: string
    picture?: string
    preferred_username?: string
  }

  if (!data.sub) throw new Error('Missing sub claim in OIDC userinfo')
  if (!data.email) throw new Error('Missing email claim in OIDC userinfo')

  return {
    email: data.email.toLowerCase(),
    name: buildDisplayName(data),
    image: data.picture || null,
    providerId: data.sub,
  }
}

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
})

async function createTransferToken(
  userInfo: OAuthUserInfo,
  provider: string,
  workspace: string,
  callbackUrl: string,
  popup: boolean
): Promise<string> {
  const secret = process.env.CLOUD_SESSION_TRANSFER_SECRET || process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('No transfer token secret configured')

  return new SignJWT({
    email: userInfo.email,
    name: userInfo.name,
    image: userInfo.image,
    provider,
    providerId: userInfo.providerId,
    workspace,
    callbackUrl,
    popup,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1m')
    .sign(new TextEncoder().encode(secret))
}

type StateResult<T> = { ok: true; state: T } | { ok: false; error: string }

function parseAndVerifyState<T>(stateParam: string, prefix: string): StateResult<T> {
  if (!stateParam.startsWith(`${prefix}:`)) {
    return { ok: false, error: 'Invalid state format' }
  }

  const signedState = stateParam.slice(prefix.length + 1)
  const state = verifyOAuthState<T>(signedState)

  if (!state) {
    console.error(`[oauth-callback] ${prefix} state signature verification failed`)
    return { ok: false, error: 'Invalid or tampered state' }
  }

  return { ok: true, state }
}

async function completeOAuthFlow(
  userInfo: OAuthUserInfo,
  provider: string,
  state: OAuthState
): Promise<string> {
  console.log(`[oauth-callback] ${provider} user: ${userInfo.email}`)

  const transferToken = await createTransferToken(
    userInfo,
    provider,
    state.workspace,
    state.callbackUrl,
    state.popup
  )

  console.log(`[oauth-callback] Redirecting to tenant domain for completion`)
  return buildCompletionUrl(state.returnDomain, transferToken)
}

function createOAuthCallback(provider: string) {
  const config = OAUTH_PROVIDERS[provider]
  if (!config) throw new Error(`Unknown provider: ${provider}`)

  return createAuthEndpoint(
    `/callback/${provider}`,
    { method: 'GET', query: callbackQuerySchema },
    async (ctx) => {
      const { code, state: stateParam, error, error_description } = ctx.query

      if (error) {
        console.error(`[oauth-callback] ${provider} error: ${error}`, error_description)
        return ctx.json({ error: `${provider} OAuth error: ${error}` }, { status: 400 })
      }

      if (!code || !stateParam) {
        return ctx.json({ error: 'Missing code or state' }, { status: 400 })
      }

      const result = parseAndVerifyState<OAuthState>(stateParam, provider)
      if (!result.ok) {
        return ctx.json({ error: result.error }, { status: 400 })
      }

      const { state } = result
      if (isStateExpired(state.ts)) {
        return ctx.redirect(
          buildErrorRedirect(state.returnDomain, state.callbackUrl, 'auth_expired')
        )
      }

      const codeVerifier = decryptCodeVerifier(state.codeVerifier)
      if (!codeVerifier) {
        console.error(`[oauth-callback] ${provider}: failed to decrypt code verifier`)
        return ctx.redirect(
          buildErrorRedirect(state.returnDomain, state.callbackUrl, 'invalid_state')
        )
      }

      try {
        const redirectUri = buildCallbackUrl(ctx.headers!, provider)
        const accessToken = await config.exchangeCode(code, redirectUri, codeVerifier)
        const userInfo = await config.getUserInfo(accessToken)
        const completeUrl = await completeOAuthFlow(userInfo, provider, state)
        return ctx.redirect(completeUrl)
      } catch (err) {
        console.error(`[oauth-callback] ${provider} error:`, err)
        return ctx.redirect(
          buildErrorRedirect(state.returnDomain, state.callbackUrl, 'auth_failed')
        )
      }
    }
  )
}

export function oauthCallback(): BetterAuthPlugin {
  return {
    id: 'oauth-callback',
    endpoints: {
      githubCallback: createOAuthCallback('github'),
      googleCallback: createOAuthCallback('google'),

      oidcCallback: createAuthEndpoint(
        '/callback/oidc',
        { method: 'GET', query: callbackQuerySchema },
        async (ctx) => {
          const { code, state: stateParam, error, error_description } = ctx.query

          if (error) {
            console.error(`[oauth-callback] OIDC error: ${error}`, error_description)
            return ctx.json({ error: `OIDC error: ${error}` }, { status: 400 })
          }

          if (!code || !stateParam) {
            return ctx.json({ error: 'Missing code or state' }, { status: 400 })
          }

          const result = parseAndVerifyState<OIDCOAuthState>(stateParam, 'oidc')
          if (!result.ok) {
            return ctx.json({ error: result.error }, { status: 400 })
          }

          const { state } = result
          if (isStateExpired(state.ts)) {
            return ctx.redirect(
              buildErrorRedirect(state.returnDomain, state.callbackUrl, 'auth_expired')
            )
          }

          if (!state.oidcConfig) {
            console.error(`[oauth-callback] Missing oidcConfig in state`)
            return ctx.redirect(
              buildErrorRedirect(state.returnDomain, state.callbackUrl, 'invalid_state')
            )
          }

          const oidcConfig = decryptOIDCConfig(state.oidcConfig)
          if (!oidcConfig) {
            console.error(`[oauth-callback] Failed to decrypt OIDC config`)
            return ctx.redirect(
              buildErrorRedirect(state.returnDomain, state.callbackUrl, 'invalid_state')
            )
          }

          const codeVerifier = decryptCodeVerifier(state.codeVerifier)
          if (!codeVerifier) {
            console.error(`[oauth-callback] OIDC: failed to decrypt code verifier`)
            return ctx.redirect(
              buildErrorRedirect(state.returnDomain, state.callbackUrl, 'invalid_state')
            )
          }

          try {
            const redirectUri = buildCallbackUrl(ctx.headers!, 'oidc')
            const accessToken = await exchangeOIDCCode(
              oidcConfig.issuer,
              oidcConfig.clientId,
              oidcConfig.clientSecret,
              code,
              redirectUri,
              codeVerifier
            )
            const userInfo = await getOIDCUserInfo(oidcConfig.issuer, accessToken)

            if (oidcConfig.emailDomain) {
              const emailDomain = userInfo.email.split('@')[1]?.toLowerCase()
              const expectedDomain = oidcConfig.emailDomain.toLowerCase()
              if (emailDomain !== expectedDomain) {
                console.error(
                  `[oauth-callback] Email domain mismatch: ${emailDomain} !== ${expectedDomain}`
                )
                return ctx.redirect(
                  buildErrorRedirect(state.returnDomain, state.callbackUrl, 'email_domain_mismatch')
                )
              }
            }

            const provider = oidcConfig.type === 'team' ? 'team-sso' : 'oidc'
            const completeUrl = await completeOAuthFlow(userInfo, provider, state)
            return ctx.redirect(completeUrl)
          } catch (err) {
            console.error(`[oauth-callback] OIDC error:`, err)
            return ctx.redirect(
              buildErrorRedirect(state.returnDomain, state.callbackUrl, 'auth_failed')
            )
          }
        }
      ),
    },
  }
}
