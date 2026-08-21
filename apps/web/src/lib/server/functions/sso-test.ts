/**
 * Admin-only SSO test sign-in server functions.
 *
 *  - startSsoTestFn: validates that the specified OIDC provider is
 *    configured + a client secret exists, fetches the IdP discovery
 *    document with an SSRF check + 5s timeout, persists a `TestSession`
 *    to the KV store under `sso-test:<state>` (10-min TTL), and returns the
 *    authorize URL the admin UI opens in a popup. PKCE (S256) — production
 *    genericOAuth runs with `pkce: true`, so the test flow mints a
 *    verifier/challenge pair to mirror that exactly.
 *
 *    The redirect_uri matches the provider's own production callback
 *    (`/api/auth/oauth2/callback/<registrationId>`) so admins register
 *    exactly one URL with their IdP. The auth catch-all intercepts test
 *    sign-ins by looking up `sso-test:<state>` in the KV store before handing
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
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { DiagnosticStep, HandshakeStage } from '@/lib/server/auth/sso-test-handshake'
import type { JsonValue } from '@/lib/server/audit/log'
import { authorizeRequestFor } from '@/lib/shared/oidc-request'
import {
  allowsMissingEmail,
  identitySourcesFor,
  profileClaimFor,
} from '@/lib/shared/oidc-claim-mapping'
import { ssoTestResultKey, ssoTestSessionKey } from '@/lib/shared/sso-test-keys'
import type { IdentityMapping } from '@/lib/server/auth/resolve-identity'

const TTL_SECONDS = 600

type TestSession = {
  testId: string
  state: string
  nonce: string
  /** The provider registrationId that initiated this test. */
  registrationId: string
  /** Mirrors the provider's placeholder-address setting so the callback can
   *  judge a missing email the same way sign-in will. */
  allowMissingEmail: boolean
  /** Present for discovery providers; absent for manual-endpoint providers. */
  discoveryUrl?: string
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
  /** Scopes requested at authorize time. Replayed into the failure hint so an
   *  invalid_scope names what was actually sent rather than a default set. */
  requestedScopes: string[]
  /** Token-endpoint auth method, mirrored from production. */
  tokenAuth: 'basic' | 'post'
  /** The prompt sent, replayed into a configuration-error hint. */
  requestedPrompt?: string
  /** Identity sources and claim paths — the same mapping production uses. */
  identityMapping?: IdentityMapping
  /** The provider's `detailsChangedAt` at test-start. The callback only stamps
   *  `lastSuccessfulTestAt` when this still matches — so a mid-test edit to the
   *  provider can't let a stale test unlock enforcement for the new config. */
  detailsChangedAt: string | null
}

export type StartSsoTestResult =
  | { testId: string; authorizeUrl: string }
  | { error: 'sso-not-configured' | 'no-secret' | 'discovery-unreachable' }

export const startSsoTestFn = createServerFn({ method: 'POST' })
  .validator(z.object({ registrationId: z.string().min(1) }))
  .handler(async ({ data }): Promise<StartSsoTestResult> => {
    const { user } = await requireAuth({ permission: PERMISSIONS.AUTH_MANAGE })

    const { listIdentityProviders, getIdentityProviderCredentials } =
      await import('@/lib/server/domains/settings/identity-providers.service')
    const providers = await listIdentityProviders()
    const provider = providers.find((p) => p.registrationId === data.registrationId)
    if (!provider || !provider.clientId) {
      return { error: 'sso-not-configured' }
    }
    // A provider is testable two ways: a discovery URL (endpoints resolved from
    // the doc), or authorization + token for installs with no discovery document.
    // Access-token-only providers never return an id_token, so JWKS/issuer are
    // not required to start the test. Production registers those too, so they
    // must be testable to be enforceable.
    const hasManualEndpoints = !!(provider.authorizationUrl && provider.tokenUrl)
    if (!provider.discoveryUrl && !hasManualEndpoints) {
      return { error: 'sso-not-configured' }
    }

    // Credentials blob is the source of the client secret; the provider
    // columns are authoritative for everything else.
    const creds = await getIdentityProviderCredentials(data.registrationId)
    if (!creds?.clientSecret) return { error: 'no-secret' }

    // Resolve the authorize/token/jwks/issuer/userinfo set from the discovery
    // doc (fetched SSRF-safe) or the stored manual endpoints.
    let endpoints: {
      issuer: string
      authorizationEndpoint: string
      tokenEndpoint: string
      jwksUri: string
      userinfoEndpoint?: string
    }
    if (provider.discoveryUrl) {
      try {
        // safeFetch validates + pins to the resolved IP and never follows
        // redirects, so a DNS rebind or a 3xx can't turn this into an
        // internal-network probe. Any failure (incl. SsrfError) → unreachable.
        const { safeFetch } = await import('@/lib/server/content/ssrf-guard')
        const res = await safeFetch(provider.discoveryUrl, { timeoutMs: 5000 })
        if (!res.ok) return { error: 'discovery-unreachable' }
        const discovery = (await res.json()) as {
          issuer: string
          authorization_endpoint: string
          token_endpoint: string
          jwks_uri: string
          userinfo_endpoint?: string
        }
        endpoints = {
          issuer: discovery.issuer,
          authorizationEndpoint: discovery.authorization_endpoint,
          tokenEndpoint: discovery.token_endpoint,
          jwksUri: discovery.jwks_uri,
          userinfoEndpoint: discovery.userinfo_endpoint,
        }
      } catch {
        return { error: 'discovery-unreachable' }
      }
    } else if (provider.authorizationUrl && provider.tokenUrl) {
      endpoints = {
        issuer: provider.issuer ?? '',
        authorizationEndpoint: provider.authorizationUrl,
        tokenEndpoint: provider.tokenUrl,
        jwksUri: provider.jwksUri ?? '',
        userinfoEndpoint: provider.userInfoUrl ?? undefined,
      }
    } else {
      // Unreachable given the guard above; satisfies definite-assignment.
      return { error: 'sso-not-configured' }
    }

    const { config } = await import('@/lib/server/config')
    // Use the provider's own production callback so admins register exactly
    // one redirect URI with their IdP. The catch-all dispatches test vs prod
    // by looking up the OAuth `state` in the KV store (miss → fall through to
    // Better-Auth), so the same URL handles both flows.
    const redirectUri = `${config.baseUrl.replace(/\/$/, '')}/api/auth/oauth2/callback/${data.registrationId}`
    const testId = `ssotest_${randomBytes(15).toString('base64url')}`
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    // PKCE (RFC 7636, S256) — mirrors production now that genericOAuth
    // runs with pkce: true. OAuth 2.1 IdPs reject authorize requests
    // without a code_challenge; IdPs without PKCE support ignore it.
    const codeVerifier = randomBytes(32).toString('base64url')
    // The SAME builder production reads. Assembling a different request here is
    // exactly how a passing test came to vouch for a sign-in that fails.
    const request = authorizeRequestFor(provider)
    const requestedScopes = request.scopes
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    const session: TestSession = {
      testId,
      state,
      nonce,
      registrationId: data.registrationId,
      allowMissingEmail: allowsMissingEmail(provider.claimMapping),
      discoveryUrl: provider.discoveryUrl ?? undefined,
      tokenEndpoint: endpoints.tokenEndpoint,
      jwksUri: endpoints.jwksUri,
      authorizationEndpoint: endpoints.authorizationEndpoint,
      userinfoEndpoint: provider.userInfoUrl ?? endpoints.userinfoEndpoint,
      issuer: endpoints.issuer,
      clientId: provider.clientId,
      clientSecret: creds.clientSecret,
      redirectUri,
      codeVerifier,
      requestedScopes,
      tokenAuth: request.tokenAuth,
      requestedPrompt: request.prompt,
      identityMapping: {
        sources: identitySourcesFor(provider.claimMapping),
        idClaim: profileClaimFor(provider.claimMapping, 'id'),
        emailClaim: profileClaimFor(provider.claimMapping, 'email'),
        nameClaim: profileClaimFor(provider.claimMapping, 'name'),
      },
      adminUserId: user.id,
      startedAt: Date.now(),
      detailsChangedAt: provider.detailsChangedAt,
    }

    const { cacheSet } = await import('@/lib/server/cache')
    await cacheSet(ssoTestSessionKey(state), session, TTL_SECONDS)

    // Mirror production: genericOAuth runs with pkce: true, so the
    // test handshake sends the same S256 code_challenge pair.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: provider.clientId,
      redirect_uri: redirectUri,
      // Mirror production exactly by sharing one resolver with the registration
      // builder. A test that sent a different scope set could pass while real
      // sign-in requests another, letting a non-representative test unlock
      // enforcement — which a stored blank `scopes` used to do, because the two
      // sides disagreed on whether blank meant "defaults" or "no scopes".
      scope: requestedScopes.join(' '),
      ...(request.prompt ? { prompt: request.prompt } : {}),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return {
      testId,
      authorizeUrl: `${endpoints.authorizationEndpoint}?${params}`,
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
        /** Merged claims the resolver saw (earlier source wins). */
        allClaims?: Record<string, JsonValue>
        /** Resolved identity + per-field provenance for the outcome preview. */
        identity?: {
          id: string
          email?: string
          name?: string
          sources: Partial<Record<'id' | 'email' | 'name', string>>
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
    await requireAuth({ permission: PERMISSIONS.AUTH_MANAGE })
    const { cacheGet } = await import('@/lib/server/cache')
    return (await cacheGet<SsoTestDiagnostic>(ssoTestResultKey(data.testId))) ?? null
  })

export type { TestSession }
