/**
 * `isAuthMethodAllowed` — the per-method enablement predicate.
 *
 * Independent of the hard-binding branch (which gates by enforced
 * verified domain). This predicate answers a single question: given
 * the workspace toggles, is provider X turned on for sign-in flow Y?
 *
 * All roles (admin / member / user) read the same unified config:
 * `workspace.authConfig.oauth`. Defaults: password ON when the key is
 * missing; magic-link OFF (admin must opt in to passwordless).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OAuthProviders } from '@/lib/server/domains/settings/settings.types'
import { makeAuthConfig, makeWorkspace } from './_helpers'

const mockGetWorkspaceSettings = vi.fn()
const mockHasPlatformCredentials = vi.fn()

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: (...a: unknown[]) => mockGetWorkspaceSettings(...a),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: (...a: unknown[]) => mockHasPlatformCredentials(...a),
}))

const { isAuthMethodAllowed: realIsAuthMethodAllowed } = await import('../auth-restrictions')

// Task 12 added a `registeredOidcProviderIds` set param (3rd) that
// short-circuits any registered OIDC provider to allowed. These tests never
// exercise an OIDC provider id except 'sso', so a fixed set containing 'sso'
// reproduces the prior `provider === 'sso'` early-return; every other tested
// id (credential, magic-link, google, …) is absent and falls through.
const reg = new Set(['sso'])
const isAuthMethodAllowed = (
  provider: string,
  role: 'admin' | 'member' | 'user',
  workspace?: Parameters<typeof realIsAuthMethodAllowed>[3]
) => realIsAuthMethodAllowed(provider, role, reg, workspace)

const workspace = (oauth: OAuthProviders) =>
  makeWorkspace({ authConfig: makeAuthConfig({ oauth, ssoOidc: null }) })

beforeEach(() => {
  vi.clearAllMocks()
  mockHasPlatformCredentials.mockResolvedValue(true)
  mockGetWorkspaceSettings.mockResolvedValue(workspace({}))
})

describe('isAuthMethodAllowed — team role', () => {
  it('allows credential when oauth.password=true', async () => {
    const r = await isAuthMethodAllowed('credential', 'admin', workspace({ password: true }))
    expect(r).toEqual({ allowed: true })
  })

  it('allows credential when oauth.password is undefined (default ON for team)', async () => {
    const r = await isAuthMethodAllowed('credential', 'admin', workspace({}))
    expect(r).toEqual({ allowed: true })
  })

  it('blocks credential when oauth.password is explicitly false', async () => {
    const r = await isAuthMethodAllowed('credential', 'admin', workspace({ password: false }))
    expect(r).toEqual({ allowed: false, error: 'password_method_not_allowed' })
  })

  it('treats provider="password" as an alias of "credential"', async () => {
    const r = await isAuthMethodAllowed('password', 'admin', workspace({ password: false }))
    expect(r).toEqual({ allowed: false, error: 'password_method_not_allowed' })
  })

  it('allows magic-link for team when oauth.magicLink is true', async () => {
    const r = await isAuthMethodAllowed('magic-link', 'admin', workspace({ magicLink: true }))
    expect(r).toEqual({ allowed: true })
  })

  it('blocks magic-link for team when oauth.magicLink is undefined (opt-in, default off)', async () => {
    const r = await isAuthMethodAllowed('magic-link', 'admin', workspace({}))
    expect(r).toEqual({ allowed: false, error: 'magic_link_method_not_allowed' })
  })

  it('blocks magic-link for team when oauth.magicLink is explicitly false', async () => {
    const r = await isAuthMethodAllowed('magic-link', 'admin', workspace({ magicLink: false }))
    expect(r).toEqual({ allowed: false, error: 'magic_link_method_not_allowed' })
  })

  it('treats legacy "email" provider id as magic-link (gated the same way)', async () => {
    const r = await isAuthMethodAllowed('email', 'admin', workspace({ magicLink: false }))
    expect(r).toEqual({ allowed: false, error: 'magic_link_method_not_allowed' })
  })

  it('always allows sso for team', async () => {
    const r = await isAuthMethodAllowed('sso', 'admin', workspace({}))
    expect(r).toEqual({ allowed: true })
  })

  it('allows OAuth provider (google) when toggle=true and credentials present', async () => {
    mockHasPlatformCredentials.mockResolvedValue(true)
    const r = await isAuthMethodAllowed('google', 'admin', workspace({ google: true }))
    expect(r).toEqual({ allowed: true })
  })

  it('blocks OAuth provider (google) when toggle=true but credentials missing', async () => {
    mockHasPlatformCredentials.mockResolvedValue(false)
    const r = await isAuthMethodAllowed('google', 'admin', workspace({ google: true }))
    expect(r).toEqual({ allowed: false, error: 'oauth_method_not_allowed' })
  })

  it('blocks OAuth provider when toggle is false', async () => {
    const r = await isAuthMethodAllowed('google', 'admin', workspace({ google: false }))
    expect(r).toEqual({ allowed: false, error: 'oauth_method_not_allowed' })
  })

  it('blocks unknown providers (toggle absent)', async () => {
    const r = await isAuthMethodAllowed('mystery', 'admin', workspace({}))
    expect(r).toEqual({ allowed: false, error: 'oauth_method_not_allowed' })
  })

  it('reuses the passed-in workspace settings instead of refetching', async () => {
    await isAuthMethodAllowed('credential', 'admin', workspace({ password: true }))
    expect(mockGetWorkspaceSettings).not.toHaveBeenCalled()
  })

  it('refetches workspace settings when not passed', async () => {
    mockGetWorkspaceSettings.mockResolvedValue(workspace({ password: false }))
    const r = await isAuthMethodAllowed('credential', 'admin')
    expect(r.allowed).toBe(false)
    expect(mockGetWorkspaceSettings).toHaveBeenCalledTimes(1)
  })

  it('applies the same policy for member as admin', async () => {
    const r = await isAuthMethodAllowed('credential', 'member', workspace({ password: false }))
    expect(r.allowed).toBe(false)
  })
})

describe('isAuthMethodAllowed — portal role (user)', () => {
  // After the unified gate, portal reads authConfig.oauth via getWorkspaceSettings,
  // same as team roles. The same defaults apply: password on unless false,
  // magic-link and social opt-in.

  it('allows credential for portal when oauth.password=true', async () => {
    const r = await isAuthMethodAllowed('credential', 'user', workspace({ password: true }))
    expect(r).toEqual({ allowed: true })
  })

  it('allows credential for portal when oauth.password is undefined (default ON)', async () => {
    const r = await isAuthMethodAllowed('credential', 'user', workspace({}))
    expect(r).toEqual({ allowed: true })
  })

  it('blocks credential for portal when oauth.password=false', async () => {
    const r = await isAuthMethodAllowed('credential', 'user', workspace({ password: false }))
    expect(r).toEqual({ allowed: false, error: 'password_method_not_allowed' })
  })

  it('blocks magic-link for portal when oauth.magicLink is absent (opt-in)', async () => {
    const r = await isAuthMethodAllowed('magic-link', 'user', workspace({}))
    expect(r).toEqual({ allowed: false, error: 'magic_link_method_not_allowed' })
  })

  it('allows magic-link for portal when oauth.magicLink=true', async () => {
    const r = await isAuthMethodAllowed('magic-link', 'user', workspace({ magicLink: true }))
    expect(r).toEqual({ allowed: true })
  })

  it('allows sso for portal users (SSO short-circuits before method gate)', async () => {
    expect(await isAuthMethodAllowed('sso', 'user')).toEqual({ allowed: true })
  })

  it('allows OAuth provider for portal when oauth toggle=true and credentials present', async () => {
    mockHasPlatformCredentials.mockResolvedValue(true)
    const r = await isAuthMethodAllowed('google', 'user', workspace({ google: true }))
    expect(r).toEqual({ allowed: true })
  })

  it('blocks OAuth provider for portal when credentials missing', async () => {
    mockHasPlatformCredentials.mockResolvedValue(false)
    const r = await isAuthMethodAllowed('google', 'user', workspace({ google: true }))
    expect(r).toEqual({ allowed: false, error: 'oauth_method_not_allowed' })
  })
})
