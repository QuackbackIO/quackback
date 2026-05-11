/**
 * Tests for the admin-only SSO test sign-in server functions:
 *
 *  - startSsoTestFn returns a typed error union when SSO is not yet
 *    configured or the client secret is missing, and otherwise builds
 *    an OIDC authorize URL (no PKCE — mirrors prod genericOAuth) and
 *    persists a TestSession to Redis.
 *  - getSsoTestResultFn (smoke covered indirectly by the result-route
 *    in 2.3; here we only assert the start flow's side effects).
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
      inputValidator() {
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
  checkUrlSafety: vi.fn(),
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
  checkUrlSafety: hoisted.checkUrlSafety,
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://qb.test' },
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_admin' } })
  hoisted.checkUrlSafety.mockResolvedValue({ safe: true })
})

// Load the module ONCE — handler order mirrors the export sequence:
//   0: startSsoTestFn
//   1: getSsoTestResultFn
await import('../sso-test')
const startSsoTest = handlers[0]

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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
    expect(result.authorizeUrl).toMatch(
      /redirect_uri=https%3A%2F%2Fqb\.test%2Fadmin%2Fsso%2Ftest%2Fcallback/
    )
    expect(result.authorizeUrl).not.toMatch(/code_challenge/)
    expect(hoisted.cacheSet).toHaveBeenCalledTimes(1)
  })
})
