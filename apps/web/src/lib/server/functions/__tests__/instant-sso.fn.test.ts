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
  getPublicPortalConfig: vi.fn(),
  getRegisteredOidcProviderIds: vi.fn(),
  getRegisteredAuthProviders: vi.fn(),
  signInWithOAuth2: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({
  getSession: hoisted.getSession,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPublicPortalConfig: hoisted.getPublicPortalConfig,
}))

vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: hoisted.getRegisteredOidcProviderIds,
  getRegisteredAuthProviders: hoisted.getRegisteredAuthProviders,
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

/** Configure the mocks for a sole-OIDC workspace (one registered provider, no
 *  other method) seen by an anonymous visitor. */
function soleOidcWorkspace(over?: {
  oidcIds?: string[]
  allIds?: string[]
  oauth?: Record<string, boolean>
}) {
  hoisted.getSession.mockResolvedValueOnce(null)
  hoisted.getRegisteredOidcProviderIds.mockResolvedValueOnce(
    new Set(over?.oidcIds ?? ['oidc_acme'])
  )
  hoisted.getRegisteredAuthProviders.mockResolvedValueOnce(over?.allIds ?? ['oidc_acme'])
  hoisted.getPublicPortalConfig.mockResolvedValueOnce({
    oauth: over?.oauth ?? { password: false, magicLink: false },
  })
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

  it('(b) redirects to the sole registered OIDC provider for an anonymous visitor', async () => {
    soleOidcWorkspace()
    hoisted.signInWithOAuth2.mockResolvedValueOnce({ url: 'https://idp.example.com/auth' })

    const result = await resolveHandler({ data: { callbackUrl: '/portal' } })

    expect(result).toEqual({ url: 'https://idp.example.com/auth' })
    expect(hoisted.signInWithOAuth2).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ providerId: 'oidc_acme', disableRedirect: true }),
      })
    )
  })

  it('(c) returns null when a built-in email method is still enabled', async () => {
    soleOidcWorkspace({ oauth: { password: true, magicLink: false } })

    const result = await resolveHandler({ data: {} })

    expect(result).toBeNull()
    expect(hoisted.signInWithOAuth2).not.toHaveBeenCalled()
  })

  it('(d) returns null when a social provider is also registered', async () => {
    soleOidcWorkspace({ oidcIds: ['oidc_acme'], allIds: ['oidc_acme', 'google'] })

    const result = await resolveHandler({ data: {} })

    expect(result).toBeNull()
    expect(hoisted.signInWithOAuth2).not.toHaveBeenCalled()
  })

  it('(e) returns null when more than one IdP is registered (the user has a choice)', async () => {
    soleOidcWorkspace({ oidcIds: ['oidc_a', 'oidc_b'], allIds: ['oidc_a', 'oidc_b'] })

    const result = await resolveHandler({ data: {} })

    expect(result).toBeNull()
    expect(hoisted.signInWithOAuth2).not.toHaveBeenCalled()
  })
})
