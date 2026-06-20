/**
 * `isAuthMethodAllowed` — the per-method enablement predicate.
 *
 * Independent of the hard-binding branch (which gates by enforced
 * verified domain). This predicate answers a single question: given
 * the workspace toggles, is provider X turned on for role Y?
 *
 * Team-role (admin / member) and portal-role (user) take different
 * paths — team reads `tenant.authConfig.oauth`, portal reads
 * `getPublicPortalConfig().oauth`. Different defaults too: team
 * defaults password ON when the key is missing; portal defaults
 * password ON for backwards compat, magic-link OFF (admin must opt
 * portal users in to passwordless).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OAuthProviders } from '@/lib/server/domains/settings/settings.types'
import { makeAuthConfig, makeTenant } from './_helpers'

const mockGetTenantSettings = vi.fn()
const mockGetPublicPortalConfig = vi.fn()
const mockHasPlatformCredentials = vi.fn()

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: (...a: unknown[]) => mockGetTenantSettings(...a),
  getPublicPortalConfig: (...a: unknown[]) => mockGetPublicPortalConfig(...a),
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
  tenant?: Parameters<typeof realIsAuthMethodAllowed>[3]
) => realIsAuthMethodAllowed(provider, role, reg, tenant)

const tenant = (oauth: OAuthProviders) =>
  makeTenant({ authConfig: makeAuthConfig({ oauth, ssoOidc: null }) })

beforeEach(() => {
  vi.clearAllMocks()
  mockHasPlatformCredentials.mockResolvedValue(true)
  mockGetPublicPortalConfig.mockResolvedValue({
    oauth: { password: true, magicLink: false },
  })
  mockGetTenantSettings.mockResolvedValue(tenant({}))
})

describe('isAuthMethodAllowed — team role', () => {
  it('allows credential when oauth.password=true', async () => {
    const r = await isAuthMethodAllowed('credential', 'admin', tenant({ password: true }))
    expect(r).toEqual({ allowed: true })
  })

  it('allows credential when oauth.password is undefined (default ON for team)', async () => {
    const r = await isAuthMethodAllowed('credential', 'admin', tenant({}))
    expect(r).toEqual({ allowed: true })
  })

  it('blocks credential when oauth.password is explicitly false', async () => {
    const r = await isAuthMethodAllowed('credential', 'admin', tenant({ password: false }))
    expect(r).toEqual({ allowed: false, error: 'password_method_not_allowed' })
  })

  it('treats provider="password" as an alias of "credential"', async () => {
    const r = await isAuthMethodAllowed('password', 'admin', tenant({ password: false }))
    expect(r).toEqual({ allowed: false, error: 'password_method_not_allowed' })
  })

  it('allows magic-link for team when oauth.magicLink is true', async () => {
    const r = await isAuthMethodAllowed('magic-link', 'admin', tenant({ magicLink: true }))
    expect(r).toEqual({ allowed: true })
  })

  it('allows magic-link for team when oauth.magicLink is undefined (default true)', async () => {
    const r = await isAuthMethodAllowed('magic-link', 'admin', tenant({}))
    expect(r).toEqual({ allowed: true })
  })

  it('blocks magic-link for team when oauth.magicLink is explicitly false', async () => {
    const r = await isAuthMethodAllowed('magic-link', 'admin', tenant({ magicLink: false }))
    expect(r).toEqual({ allowed: false, error: 'magic_link_method_not_allowed' })
  })

  it('treats legacy "email" provider id as magic-link (gated the same way)', async () => {
    const r = await isAuthMethodAllowed('email', 'admin', tenant({ magicLink: false }))
    expect(r).toEqual({ allowed: false, error: 'magic_link_method_not_allowed' })
  })

  it('always allows sso for team', async () => {
    const r = await isAuthMethodAllowed('sso', 'admin', tenant({}))
    expect(r).toEqual({ allowed: true })
  })

  it('allows OAuth provider (google) when toggle=true and credentials present', async () => {
    mockHasPlatformCredentials.mockResolvedValue(true)
    const r = await isAuthMethodAllowed('google', 'admin', tenant({ google: true }))
    expect(r).toEqual({ allowed: true })
  })

  it('blocks OAuth provider (google) when toggle=true but credentials missing', async () => {
    mockHasPlatformCredentials.mockResolvedValue(false)
    const r = await isAuthMethodAllowed('google', 'admin', tenant({ google: true }))
    expect(r).toEqual({ allowed: false, error: 'oauth_method_not_allowed' })
  })

  it('blocks OAuth provider when toggle is false', async () => {
    const r = await isAuthMethodAllowed('google', 'admin', tenant({ google: false }))
    expect(r).toEqual({ allowed: false, error: 'oauth_method_not_allowed' })
  })

  it('blocks unknown providers (toggle absent)', async () => {
    const r = await isAuthMethodAllowed('mystery', 'admin', tenant({}))
    expect(r).toEqual({ allowed: false, error: 'oauth_method_not_allowed' })
  })

  it('reuses the passed-in tenant settings instead of refetching', async () => {
    await isAuthMethodAllowed('credential', 'admin', tenant({ password: true }))
    expect(mockGetTenantSettings).not.toHaveBeenCalled()
  })

  it('refetches tenant settings when not passed', async () => {
    mockGetTenantSettings.mockResolvedValue(tenant({ password: false }))
    const r = await isAuthMethodAllowed('credential', 'admin')
    expect(r.allowed).toBe(false)
    expect(mockGetTenantSettings).toHaveBeenCalledTimes(1)
  })

  it('applies the same policy for member as admin', async () => {
    const r = await isAuthMethodAllowed('credential', 'member', tenant({ password: false }))
    expect(r.allowed).toBe(false)
  })
})

describe('isAuthMethodAllowed — portal role (user)', () => {
  it('allows credential when portalConfig.oauth.password=true', async () => {
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: true, magicLink: false },
    })
    const r = await isAuthMethodAllowed('credential', 'user')
    expect(r).toEqual({ allowed: true })
  })

  it('allows credential when portalConfig.oauth.password is undefined (default ON for portal too)', async () => {
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { magicLink: false },
    })
    const r = await isAuthMethodAllowed('credential', 'user')
    expect(r).toEqual({ allowed: true })
  })

  it('blocks credential when portalConfig.oauth.password=false', async () => {
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: false, magicLink: false },
    })
    const r = await isAuthMethodAllowed('credential', 'user')
    expect(r).toEqual({ allowed: false, error: 'password_method_not_allowed' })
  })

  it('blocks magic-link by default for portal (admin must opt in)', async () => {
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: true },
    })
    const r = await isAuthMethodAllowed('magic-link', 'user')
    expect(r).toEqual({ allowed: false, error: 'magic_link_method_not_allowed' })
  })

  it('allows magic-link for portal when opted in', async () => {
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: true, magicLink: true },
    })
    const r = await isAuthMethodAllowed('magic-link', 'user')
    expect(r).toEqual({ allowed: true })
  })

  it('allows sso for portal users regardless of the portal oauth map (SSO is role-agnostic)', async () => {
    mockGetPublicPortalConfig.mockResolvedValue({ oauth: {} })
    expect(await isAuthMethodAllowed('sso', 'user')).toEqual({ allowed: true })
  })

  it('allows OAuth provider for portal when explicitly enabled', async () => {
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: true, magicLink: false, google: true },
    })
    const r = await isAuthMethodAllowed('google', 'user')
    expect(r).toEqual({ allowed: true })
  })

  it('does not consult the workspace-side hasPlatformCredentials for portal OAuth', async () => {
    mockHasPlatformCredentials.mockResolvedValue(false)
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: true, magicLink: false, google: true },
    })
    const r = await isAuthMethodAllowed('google', 'user')
    expect(r).toEqual({ allowed: true })
    expect(mockHasPlatformCredentials).not.toHaveBeenCalled()
  })
})
