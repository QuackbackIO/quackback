/**
 * Tests for the admin-only SSO test sign-in server functions:
 *
 *  - startSsoTestFn returns a typed error union when SSO is not yet
 *    configured or the client secret is missing, and otherwise builds
 *    an OIDC authorize URL (S256 PKCE — mirrors prod genericOAuth's
 *    pkce: true) using
 *    the SAME redirect_uri as production SSO sign-in, and persists a
 *    TestSession to Redis. The auth catch-all discriminates test from
 *    production by looking up the state in Redis — see
 *    `sso-test-callback.test.ts` for the handler tests.
 *  - getSsoTestResultFn gates on admin auth, polls the result key, and
 *    returns null until the callback writes its diagnostic payload.
 *
 * Uses the same `createServerFn` capture pattern as the other
 * `functions/__tests__` suites — the registered handler is the second
 * arg passed to `.handler()` post-AST-transform, but in tests (no
 * transform) it's the first arg. We mock the builder to capture it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  requireAuth: vi.fn(),
  getTenantSettings: vi.fn(),
  getSsoClientSecret: vi.fn(),
  safeFetch: vi.fn(),
}))

vi.mock('@/lib/server/redis', () => ({
  cacheGet: hoisted.cacheGet,
  cacheSet: hoisted.cacheSet,
  cacheDel: hoisted.cacheDel,
  CACHE_KEYS: {},
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: hoisted.getTenantSettings,
}))

vi.mock('@/lib/server/auth/sso-secret', () => ({
  getSsoClientSecret: hoisted.getSsoClientSecret,
}))

vi.mock('@/lib/server/content/ssrf-guard', () => ({
  safeFetch: hoisted.safeFetch,
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://qb.test' },
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_admin' } })
})

// Load the module ONCE — handler order mirrors the export sequence:
//   0: startSsoTestFn
//   1: getSsoTestResultFn
await import('../sso-test')
const startSsoTest = handlers[0]
const getSsoTestResult = handlers[1]

describe('startSsoTestFn', () => {
  it('returns no-config error when ssoOidc is missing', async () => {
    hoisted.getTenantSettings.mockResolvedValue({ authConfig: {} })

    const result = await startSsoTest({ data: {} })
    expect(result).toMatchObject({ error: 'sso-not-configured' })
  })

  it('returns no-secret error when secret is missing', async () => {
    hoisted.getTenantSettings.mockResolvedValue({
      authConfig: {
        ssoOidc: {
          enabled: true,
          discoveryUrl: 'https://idp',
          clientId: 'c',
          autoCreateUsers: false,
        },
      },
    })
    hoisted.getSsoClientSecret.mockResolvedValue(null)

    const result = await startSsoTest({ data: {} })
    expect(result).toMatchObject({ error: 'no-secret' })
  })

  it('returns testId + authorizeUrl when preconditions met', async () => {
    hoisted.getTenantSettings.mockResolvedValue({
      authConfig: {
        ssoOidc: {
          enabled: true,
          discoveryUrl: 'https://idp/.well-known',
          clientId: 'c',
          autoCreateUsers: false,
        },
      },
    })
    hoisted.getSsoClientSecret.mockResolvedValue('secret')
    hoisted.safeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          issuer: 'https://idp',
          authorization_endpoint: 'https://idp/auth',
          token_endpoint: 'https://idp/token',
          jwks_uri: 'https://idp/jwks',
        }),
        { status: 200 }
      )
    )
    hoisted.cacheSet.mockResolvedValue(undefined)

    const result = (await startSsoTest({ data: {} })) as {
      testId: string
      authorizeUrl: string
    }

    expect(result.testId).toMatch(/^ssotest_/)
    expect(result.authorizeUrl).toMatch(/^https:\/\/idp\/auth\?/)
    // Reuses the production SSO callback so admins only register one
    // URL with their IdP. The auth catch-all discriminates by state.
    expect(result.authorizeUrl).toMatch(
      /redirect_uri=https%3A%2F%2Fqb\.test%2Fapi%2Fauth%2Foauth2%2Fcallback%2Fsso/
    )
    // PKCE is mandatory for OAuth 2.1 IdPs (e.g. Supabase Auth) and
    // ignored by IdPs that don't support it — the authorize URL must
    // carry an S256 challenge pair, mirroring production (pkce: true).
    expect(result.authorizeUrl).toMatch(/code_challenge=[A-Za-z0-9_-]{43}/)
    expect(result.authorizeUrl).toMatch(/code_challenge_method=S256/)
    expect(hoisted.cacheSet).toHaveBeenCalledTimes(1)
  })
})

describe('getSsoTestResultFn', () => {
  it('requires admin auth (rejects when requireAuth throws)', async () => {
    hoisted.requireAuth.mockRejectedValueOnce(new Error('unauthenticated'))

    await expect(getSsoTestResult({ data: { testId: 'ssotest_abc' } })).rejects.toThrow(
      /unauthenticated/i
    )
    expect(hoisted.cacheGet).not.toHaveBeenCalled()
  })

  it('returns null when no diagnostic has been written yet', async () => {
    hoisted.cacheGet.mockResolvedValueOnce(null)

    const result = await getSsoTestResult({ data: { testId: 'ssotest_abc' } })
    expect(result).toBeNull()
    expect(hoisted.cacheGet).toHaveBeenCalledWith('sso-test:result:ssotest_abc')
  })

  it('returns the diagnostic payload verbatim when present', async () => {
    const diagnostic = {
      result: {
        ok: true as const,
        steps: [{ ok: true, stage: 'state-validation' as const, label: 'state' }],
        claims: { iss: 'https://idp', sub: 'u1', aud: 'cid' },
        tokenInfo: {
          idTokenAlg: 'RS256',
          hasAccessToken: true,
          hasRefreshToken: false,
        },
      },
    }
    hoisted.cacheGet.mockResolvedValueOnce(diagnostic)

    const result = await getSsoTestResult({ data: { testId: 'ssotest_xyz' } })
    expect(result).toBe(diagnostic)
    expect(hoisted.cacheGet).toHaveBeenCalledWith('sso-test:result:ssotest_xyz')
  })
})
