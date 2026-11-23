/**
 * The "Email magic link" method at `/magic-link/verify`.
 *
 * The send side refuses while the method is off, but a link mailed while it was
 * on stays redeemable for its lifetime. The verify side refuses those once the
 * method is off. It must refuse ONLY those: invitations, portal invites, the
 * workspace claim and recovery-code break-glass all redeem through the same
 * endpoint and are grants the workspace made, which have to work with the
 * method off (its default).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  sso: { ssoLive: true, providersConfigured: false },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: (...a: unknown[]) => hoisted.getWorkspaceSettings(...a),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => [],
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: async () => new Set<string>(),
  getSsoSignInState: async () => hoisted.sso,
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const { handleMagicLinkVerifyGate } = await import('../hooks')

const SIGNIN_TOKEN = 'es-abcdefghijklmnopqrstuvwxyzABCDEF'
const GRANT_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEF'

function ctxFor(path: string, token: string) {
  return {
    path,
    query: { token, callbackURL: '/roadmap' },
    redirect: vi.fn((url: string) => new Error(`REDIRECT:${url}`)),
  }
}

function methodOn(on: boolean) {
  hoisted.getWorkspaceSettings.mockResolvedValue({
    authConfig: { oauth: { password: true, magicLink: on } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.sso = { ssoLive: true, providersConfigured: false }
  methodOn(false)
})

describe('handleMagicLinkVerifyGate', () => {
  it('refuses an email sign-in link while the method is off', async () => {
    const ctx = ctxFor('/magic-link/verify', SIGNIN_TOKEN)

    await expect(handleMagicLinkVerifyGate(ctx)).rejects.toThrow(
      'REDIRECT:/?auth=signin&error=magic_link_method_not_allowed'
    )
  })

  it('lets an email sign-in link through while the method is on', async () => {
    methodOn(true)
    const ctx = ctxFor('/magic-link/verify', SIGNIN_TOKEN)

    await handleMagicLinkVerifyGate(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('lets an email sign-in link through while it stands in for paused single sign-on', async () => {
    hoisted.sso = { ssoLive: false, providersConfigured: true }
    const ctx = ctxFor('/magic-link/verify', SIGNIN_TOKEN)

    await handleMagicLinkVerifyGate(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  // Invitations, recovery codes and the claim: never governed by the method.
  it('lets a link the workspace granted through while the method is off', async () => {
    const ctx = ctxFor('/magic-link/verify', GRANT_TOKEN)

    await handleMagicLinkVerifyGate(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
    expect(hoisted.getWorkspaceSettings).not.toHaveBeenCalled()
  })

  it('ignores every other path', async () => {
    const ctx = ctxFor('/sign-in/email', SIGNIN_TOKEN)

    await handleMagicLinkVerifyGate(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })
})
