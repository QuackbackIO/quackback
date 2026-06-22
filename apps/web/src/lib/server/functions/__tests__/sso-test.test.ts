/**
 * Tests for the admin-only SSO test sign-in server functions:
 *
 *  - startSsoTestFn accepts a `registrationId`, resolves the provider via
 *    `listIdentityProviders`, fetches the credential secret via
 *    `getIdentityProviderCredentials`, builds a per-provider OIDC authorize
 *    URL (S256 PKCE — mirrors prod genericOAuth's pkce: true), persists a
 *    TestSession (carrying registrationId) to Redis, and returns the
 *    authorize URL with a redirect_uri matching the provider's own
 *    production callback.
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
  listIdentityProviders: vi.fn(),
  getIdentityProviderCredentials: vi.fn(),
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

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: hoisted.listIdentityProviders,
  getIdentityProviderCredentials: hoisted.getIdentityProviderCredentials,
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

/** A minimal provider row returned by listIdentityProviders. */
const ssoProvider = {
  id: 'idp_sso',
  registrationId: 'sso',
  discoveryUrl: 'https://idp/.well-known',
  clientId: 'c',
  domains: [],
}

describe('startSsoTestFn', () => {
  it('returns no-config error when provider is not found', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([])

    const result = await startSsoTest({ data: { registrationId: 'sso' } })
    expect(result).toMatchObject({ error: 'sso-not-configured' })
  })

  it('returns no-config error when provider lacks discoveryUrl', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([{ ...ssoProvider, discoveryUrl: null }])

    const result = await startSsoTest({ data: { registrationId: 'sso' } })
    expect(result).toMatchObject({ error: 'sso-not-configured' })
  })

  it('returns no-secret error when credential blob has no clientSecret', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([ssoProvider])
    hoisted.getIdentityProviderCredentials.mockResolvedValue(null)

    const result = await startSsoTest({ data: { registrationId: 'sso' } })
    expect(result).toMatchObject({ error: 'no-secret' })
  })

  it('returns testId + authorizeUrl when preconditions met (legacy sso provider)', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([ssoProvider])
    hoisted.getIdentityProviderCredentials.mockResolvedValue({ clientSecret: 'secret' })
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

    const result = (await startSsoTest({ data: { registrationId: 'sso' } })) as {
      testId: string
      authorizeUrl: string
    }

    expect(result.testId).toMatch(/^ssotest_/)
    expect(result.authorizeUrl).toMatch(/^https:\/\/idp\/auth\?/)
    // Redirect URI is the provider's own production callback.
    expect(result.authorizeUrl).toMatch(
      /redirect_uri=https%3A%2F%2Fqb\.test%2Fapi%2Fauth%2Foauth2%2Fcallback%2Fsso/
    )
    // PKCE is mandatory for OAuth 2.1 IdPs and ignored by IdPs that don't
    // support it — the authorize URL must carry an S256 challenge pair.
    expect(result.authorizeUrl).toMatch(/code_challenge=[A-Za-z0-9_-]{43}/)
    expect(result.authorizeUrl).toMatch(/code_challenge_method=S256/)
    expect(hoisted.cacheSet).toHaveBeenCalledTimes(1)

    // Session persisted to Redis must carry the registrationId.
    const [, session] = hoisted.cacheSet.mock.calls[0] as [string, { registrationId: string }]
    expect(session.registrationId).toBe('sso')
  })

  it('uses the provider-specific callback path for a non-sso registrationId', async () => {
    const customProvider = {
      id: 'idp_abc',
      registrationId: 'oidc_abc123',
      discoveryUrl: 'https://custom-idp/.well-known',
      clientId: 'custom-client',
      domains: [],
    }
    hoisted.listIdentityProviders.mockResolvedValue([customProvider])
    hoisted.getIdentityProviderCredentials.mockResolvedValue({ clientSecret: 'secret2' })
    hoisted.safeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          issuer: 'https://custom-idp',
          authorization_endpoint: 'https://custom-idp/auth',
          token_endpoint: 'https://custom-idp/token',
          jwks_uri: 'https://custom-idp/jwks',
        }),
        { status: 200 }
      )
    )
    hoisted.cacheSet.mockResolvedValue(undefined)

    const result = (await startSsoTest({ data: { registrationId: 'oidc_abc123' } })) as {
      testId: string
      authorizeUrl: string
    }

    // Redirect URI must be the provider's OWN callback, not the legacy sso path.
    expect(result.authorizeUrl).toMatch(
      /redirect_uri=https%3A%2F%2Fqb\.test%2Fapi%2Fauth%2Foauth2%2Fcallback%2Foidc_abc123/
    )

    // Session must carry the correct registrationId.
    const [, session] = hoisted.cacheSet.mock.calls[0] as [string, { registrationId: string }]
    expect(session.registrationId).toBe('oidc_abc123')
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
