/**
 * Loop-safety and happy-path coverage for resolveInstantSsoRedirectFn.
 *
 * Uses the same createServerFn capture pattern as other suites in this
 * directory: the builder is mocked so the registered handler is pushed
 * onto `handlers` and driven directly.
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

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPublicOidcProviders: vi.fn(),
  getPublicPortalConfig: vi.fn(),
  resolveInstantSsoProvider: vi.fn(),
  signInWithOAuth2: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({
  getSession: hoisted.getSession,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPublicOidcProviders: hoisted.getPublicOidcProviders,
  getPublicPortalConfig: hoisted.getPublicPortalConfig,
}))

vi.mock('@/lib/server/auth/instant-sso', () => ({
  resolveInstantSsoProvider: hoisted.resolveInstantSsoProvider,
}))

vi.mock('@/lib/server/auth', () => ({
  auth: {
    api: {
      signInWithOAuth2: hoisted.signInWithOAuth2,
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

await import('../instant-sso')

const resolveHandler = handlers[0]
if (typeof resolveHandler !== 'function') {
  throw new Error(
    `resolveInstantSsoRedirectFn handler not found at index 0 — found ${handlers.length} handlers`
  )
}

describe('resolveInstantSsoRedirectFn', () => {
  it('(a) returns null without calling signInWithOAuth2 when a non-anonymous user is signed in', async () => {
    hoisted.getSession.mockResolvedValueOnce({
      user: { principalType: 'user', id: 'user_1', email: 'alice@example.com' },
    })

    const result = await resolveHandler({ data: {} })

    expect(result).toBeNull()
    expect(hoisted.signInWithOAuth2).not.toHaveBeenCalled()
  })

  it('(b) returns { url } when anonymous and instant-SSO provider resolves', async () => {
    hoisted.getSession.mockResolvedValueOnce(null)
    hoisted.getPublicOidcProviders.mockResolvedValueOnce([])
    hoisted.getPublicPortalConfig.mockResolvedValueOnce({ oauth: {} })
    hoisted.resolveInstantSsoProvider.mockReturnValueOnce('oidc_acme')
    hoisted.signInWithOAuth2.mockResolvedValueOnce({ url: 'https://idp.example.com/auth' })

    const result = await resolveHandler({ data: { callbackUrl: '/portal' } })

    expect(result).toEqual({ url: 'https://idp.example.com/auth' })
    expect(hoisted.signInWithOAuth2).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ providerId: 'oidc_acme', disableRedirect: true }),
      })
    )
  })
})
