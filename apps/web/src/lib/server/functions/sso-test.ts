/**
 * Admin-only SSO test sign-in server functions.
 *
 *  - startSsoTestFn: validates that the specified OIDC provider is
 *    configured + a client secret exists, fetches the IdP discovery
 *    document with an SSRF check + 5s timeout, persists a `TestSession`
 *    to Redis under `sso-test:<state>` (10-min TTL), and returns the
 *    authorize URL the admin UI opens in a popup. PKCE (S256) — production
 *    genericOAuth runs with `pkce: true`, so the test flow mints a
 *    verifier/challenge pair to mirror that exactly.
 *
 *    The redirect_uri matches the provider's own production callback
 *    (`/api/auth/oauth2/callback/<registrationId>`) so admins register
 *    exactly one URL with their IdP. The auth catch-all intercepts test
 *    sign-ins by looking up `sso-test:<state>` in Redis before handing
 *    off to Better-Auth — see `sso-test-callback.ts`.
 *
 *  - getSsoTestResultFn: polls the `sso-test:result:<testId>` key
 *    written by the callback handler and returns the diagnostic
 *    payload or null if not ready.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import type { DiagnosticStep, HandshakeStage } from '@/lib/server/auth/sso-test-handshake'
import { ssoTestResultKey, ssoTestSessionKey } from '@/lib/shared/sso-test-keys'

const TTL_SECONDS = 600

type TestSession = {
  testId: string
  state: string
  nonce: string
  /** The provider registrationId that initiated this test. */
  registrationId: string
  discoveryUrl: string
  tokenEndpoint: string
  jwksUri: string
  authorizationEndpoint: string
  userinfoEndpoint?: string
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  adminUserId: string
  startedAt: number
  codeVerifier: string
}

export type StartSsoTestResult =
  | { testId: string; authorizeUrl: string }
  | { error: 'sso-not-configured' | 'no-secret' | 'discovery-unreachable' }

export const startSsoTestFn = createServerFn({ method: 'POST' })
  .validator(z.object({ registrationId: z.string().min(1) }))
  .handler(async ({ data }): Promise<StartSsoTestResult> => {
    const { user } = await requireAuth({ roles: ['admin'] })

    const { listIdentityProviders, getIdentityProviderCredentials } =
      await import('@/lib/server/domains/settings/identity-providers.service')
    const providers = await listIdentityProviders()
    const provider = providers.find((p) => p.registrationId === data.registrationId)
    if (!provider || !provider.discoveryUrl || !provider.clientId) {
      return { error: 'sso-not-configured' }
    }

    // Credentials blob is the source of the client secret; the provider
    // columns (discoveryUrl, clientId) are authoritative for everything else.
    const creds = await getIdentityProviderCredentials(data.registrationId)
    if (!creds?.clientSecret) return { error: 'no-secret' }

    let discovery: {
      issuer: string
      authorization_endpoint: string
      token_endpoint: string
      jwks_uri: string
      userinfo_endpoint?: string
    }
    try {
      // safeFetch validates + pins to the resolved IP and never follows
      // redirects, so a DNS rebind or a 3xx can't turn this into an
      // internal-network probe. Any failure (incl. SsrfError) → unreachable.
      const { safeFetch } = await import('@/lib/server/content/ssrf-guard')
      const res = await safeFetch(provider.discoveryUrl, { timeoutMs: 5000 })
      if (!res.ok) return { error: 'discovery-unreachable' }
      discovery = await res.json()
    } catch {
      return { error: 'discovery-unreachable' }
    }

    const { config } = await import('@/lib/server/config')
    // Use the provider's own production callback so admins register exactly
    // one redirect URI with their IdP. The catch-all dispatches test vs prod
    // by looking up the OAuth `state` in Redis (miss → fall through to
    // Better-Auth), so the same URL handles both flows.
    const redirectUri = `${config.baseUrl.replace(/\/$/, '')}/api/auth/oauth2/callback/${data.registrationId}`
    const testId = `ssotest_${randomBytes(15).toString('base64url')}`
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    // PKCE (RFC 7636, S256) — mirrors production now that genericOAuth
    // runs with pkce: true. OAuth 2.1 IdPs reject authorize requests
    // without a code_challenge; IdPs without PKCE support ignore it.
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    const session: TestSession = {
      testId,
      state,
      nonce,
      registrationId: data.registrationId,
      discoveryUrl: provider.discoveryUrl,
      tokenEndpoint: discovery.token_endpoint,
      jwksUri: discovery.jwks_uri,
      authorizationEndpoint: discovery.authorization_endpoint,
      userinfoEndpoint: discovery.userinfo_endpoint,
      issuer: discovery.issuer,
      clientId: provider.clientId,
      clientSecret: creds.clientSecret,
      redirectUri,
      codeVerifier,
      adminUserId: user.id,
      startedAt: Date.now(),
    }

    const { cacheSet } = await import('@/lib/server/redis')
    await cacheSet(ssoTestSessionKey(state), session, TTL_SECONDS)

    // Mirror production: genericOAuth runs with pkce: true, so the
    // test handshake sends the same S256 code_challenge pair.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: provider.clientId,
      redirect_uri: redirectUri,
      // Mirror production: buildGenericOAuthConfigs requests provider.scopes
      // (falling back to the default trio). A test that always sent
      // 'openid email profile' could pass while real sign-in requests a
      // different set — letting a non-representative test unlock enforcement.
      scope: provider.scopes ?? 'openid email profile',
      state,
      nonce,
      prompt: 'login',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return {
      testId,
      authorizeUrl: `${discovery.authorization_endpoint}?${params}`,
    }
  })

/**
 * Wire-safe diagnostic payload the callback route writes for the admin
 * UI. Mirrors `HandshakeResult` but strips the failure-branch `raw?:
 * unknown` debug field, which TanStack's serializable-input check
 * rejects. The callback route does the strip on write.
 */
export type SsoTestDiagnostic = {
  result:
    | {
        ok: true
        steps: DiagnosticStep[]
        claims: {
          iss: string
          sub: string
          aud: string | string[]
          email?: string
          email_verified?: boolean
          name?: string
          preferred_username?: string
        }
        tokenInfo: {
          idTokenAlg: string
          hasAccessToken: boolean
          hasRefreshToken: boolean
          expiresIn?: number
        }
      }
    | {
        ok: false
        stage: HandshakeStage
        errorCode?: string
        hint: string
        steps: DiagnosticStep[]
      }
  /**
   * Set when result.ok and the IdP-returned `email` claim
   * case-insensitively matches the admin who started the test.
   * When true, `principal.last_sso_sign_in_at` has been updated
   * for that admin and the per-domain SSO enforcement bootstrap
   * gate is satisfied for the standard 7-day window.
   */
  identityMatched?: boolean
}

export const getSsoTestResultFn = createServerFn({ method: 'POST' })
  .validator(z.object({ testId: z.string() }))
  .handler(async ({ data }): Promise<SsoTestDiagnostic | null> => {
    await requireAuth({ roles: ['admin'] })
    const { cacheGet } = await import('@/lib/server/redis')
    return (await cacheGet<SsoTestDiagnostic>(ssoTestResultKey(data.testId))) ?? null
  })

export type { TestSession }
