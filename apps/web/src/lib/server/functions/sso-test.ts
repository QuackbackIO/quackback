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
 *  - getSsoTestResultFn: polls the `sso-test:result:<testId>` key
 *    written by the callback route (Task 2.3) and returns the
 *    diagnostic payload or null if not ready.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import type { DiagnosticStep, HandshakeStage } from '@/lib/server/auth/sso-test-handshake'

const CACHE_PREFIX = 'sso-test:'
const TTL_SECONDS = 600

type TestSession = {
  testId: string
  state: string
  nonce: string
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

/** 32-byte → ~43-char base64url string. Used for state/nonce. */
function randomBase64Url(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

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
      const { checkUrlSafety } = await import('@/lib/server/content/ssrf-guard')
      const safety = await checkUrlSafety(sso.discoveryUrl)
      if (!safety.safe) return { error: 'discovery-unreachable' }
      const res = await fetch(sso.discoveryUrl, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return { error: 'discovery-unreachable' }
      discovery = await res.json()
    } catch {
      return { error: 'discovery-unreachable' }
    }

    const { config } = await import('@/lib/server/config')
    const redirectUri = `${config.baseUrl.replace(/\/$/, '')}/admin/sso/test/callback`
    const testId = `ssotest_${randomBase64Url(15)}`
    const state = randomBase64Url(32)
    const nonce = randomBase64Url(32)

    const session: TestSession = {
      testId,
      state,
      nonce,
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
    await cacheSet(`${CACHE_PREFIX}${state}`, session, TTL_SECONDS)

    // Mirror production: no PKCE on the authorize request because
    // genericOAuth doesn't send code_verifier on the token request.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: sso.clientId,
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      prompt: 'login',
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
}

export const getSsoTestResultFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ testId: z.string() }))
  .handler(async ({ data }): Promise<SsoTestDiagnostic | null> => {
    await requireAuth({ roles: ['admin'] })
    const { cacheGet } = await import('@/lib/server/redis')
    return (await cacheGet<SsoTestDiagnostic>(`${CACHE_PREFIX}result:${data.testId}`)) ?? null
  })

export type { TestSession }
