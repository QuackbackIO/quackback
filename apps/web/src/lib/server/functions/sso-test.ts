/**
 * Admin-only SSO test sign-in server functions.
 *
 *  - startSsoTestFn: validates that OIDC is configured + a client
 *    secret exists, fetches the IdP discovery document with an SSRF
 *    check + 5s timeout, persists a `TestSession` to Redis under
 *    `sso-test:<state>` (10-min TTL), and returns the authorize URL
 *    the admin UI opens in a popup. NO PKCE — production genericOAuth
 *    doesn't send `code_verifier` on the token request, so the test
 *    flow has to mirror that exactly or it'd diagnose a non-issue.
 *
 *    The redirect_uri matches the production Better-Auth SSO callback
 *    so admins only register one URL with their IdP. The auth catch-all
 *    intercepts test sign-ins by looking up `sso-test:<state>` in Redis
 *    before handing off to Better-Auth — see `sso-test-callback.ts`.
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
import {
  ssoTestResultKey,
  ssoTestSessionKey,
  SSO_OAUTH_CALLBACK_PATH,
} from '@/lib/shared/sso-test-keys'

const TTL_SECONDS = 600

type TestSession = {
  testId: string
  state: string
  nonce: string
  /** PKCE code_verifier — the high-entropy plaintext the IdP will hash
   *  and compare against the `code_challenge` we sent on /authorize. We
   *  hold onto it for the token-exchange step so the IdP can verify. */
  codeVerifier: string
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
}

export type StartSsoTestResult =
  | { testId: string; authorizeUrl: string }
  | { error: 'sso-not-configured' | 'no-secret' | 'discovery-unreachable' }

export const startSsoTestFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({}))
  .handler(async (): Promise<StartSsoTestResult> => {
    const { user } = await requireAuth({ roles: ['admin'] })

    const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
    const tenant = await getTenantSettings()
    const sso = tenant?.authConfig?.ssoOidc
    if (!sso?.discoveryUrl || !sso?.clientId) {
      return { error: 'sso-not-configured' }
    }

    const { getSsoClientSecret } = await import('@/lib/server/auth/sso-secret')
    const clientSecret = await getSsoClientSecret()
    if (!clientSecret) return { error: 'no-secret' }

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
      const res = await safeFetch(sso.discoveryUrl, { timeoutMs: 5000 })
      if (!res.ok) return { error: 'discovery-unreachable' }
      discovery = await res.json()
    } catch {
      return { error: 'discovery-unreachable' }
    }

    const { config } = await import('@/lib/server/config')
    // Same callback URL as production SSO sign-in. Better-Auth's
    // Test flow piggy-backs on the production redirect URI; the catch-
    // all dispatches by OAuth `state` (see SSO_OAUTH_CALLBACK_PATH).
    const redirectUri = `${config.baseUrl.replace(/\/$/, '')}${SSO_OAUTH_CALLBACK_PATH}`
    const testId = `ssotest_${randomBytes(15).toString('base64url')}`
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    // PKCE per RFC 7636 — `genericOAuth` enables PKCE by default in
    // production (see `create-authorization-url.mjs:3` in better-auth/core
    // and the `pkce` default of `true`), so the test flow must too —
    // otherwise we'd diagnose a different protocol than the one users
    // actually sign in with, and IdPs that set `requirePKCE: true`
    // (e.g. better-auth's own oidc-provider with that flag, our
    // sister InterpriseOne IdP) reject the test with
    // `error=invalid_request&error_description=pkce is required`.
    // 32 random bytes → 43 chars base64url, comfortably inside the
    // 43–128 character window mandated by §4.1.
    const codeVerifier = randomBytes(32).toString('base64url')
    // S256 is mandatory for any modern IdP; `plain` is permitted by the
    // spec but considered legacy. Quackback's prod uses S256 and the
    // test must mirror that.
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    const session: TestSession = {
      testId,
      state,
      nonce,
      codeVerifier,
      discoveryUrl: sso.discoveryUrl,
      tokenEndpoint: discovery.token_endpoint,
      jwksUri: discovery.jwks_uri,
      authorizationEndpoint: discovery.authorization_endpoint,
      userinfoEndpoint: discovery.userinfo_endpoint,
      issuer: discovery.issuer,
      clientId: sso.clientId,
      clientSecret,
      redirectUri,
      adminUserId: user.id,
      startedAt: Date.now(),
    }

    const { cacheSet } = await import('@/lib/server/redis')
    await cacheSet(ssoTestSessionKey(state), session, TTL_SECONDS)

    // Mirror production:
    //   - `prompt=select_account` matches the production SSO config in
    //     [auth/index.ts](../auth/index.ts) (the `genericOAuthConfigs.push`
    //     call for providerId='sso'). An earlier revision sent
    //     `prompt=login`, which made the test diverge from production
    //     and triggered an unbreakable loop on IdPs whose login page
    //     auto-redirects an already-authenticated user back to authorize
    //     (authorize→/login→/authorize forever). The handshake test only
    //     needs to verify discovery → authorize → token → userinfo
    //     round-trip; forced re-auth isn't what's being validated.
    //   - `code_challenge` / `code_challenge_method` enable PKCE.
    //     better-auth's `genericOAuth` plugin defaults `pkce: true`, so
    //     production sends these too. Skipping them in the test made the
    //     test pass against permissive IdPs but fail against IdPs that
    //     enforce PKCE — including better-auth's own oidc-provider with
    //     `requirePKCE: true`.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: sso.clientId,
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      prompt: 'select_account',
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
  .inputValidator(z.object({ testId: z.string() }))
  .handler(async ({ data }): Promise<SsoTestDiagnostic | null> => {
    await requireAuth({ roles: ['admin'] })
    const { cacheGet } = await import('@/lib/server/redis')
    return (await cacheGet<SsoTestDiagnostic>(ssoTestResultKey(data.testId))) ?? null
  })

export type { TestSession }
