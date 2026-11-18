/**
 * Email sign-in when the plan no longer includes single sign-on.
 *
 * A workspace can be set up to sign in only through its identity provider,
 * with password and email links turned off. When the plan drops the
 * `customOidcProvider` feature the provider stops registering, so without a
 * fallback nobody on the team could sign in. Email links are offered instead,
 * computed at read time: nothing stored changes, and with the feature back the
 * workspace behaves exactly as stored.
 *
 * The doubles sit on the real dependencies the auth layer reads (plan limits,
 * the provider list, saved credentials), so the provider registry and the
 * method gate run as they do in production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { makeAuthConfig, makeVerifiedDomain, makeWorkspace } from './_helpers'

const state = vi.hoisted(() => ({
  ssoInPlan: false,
  providers: [] as IdentityProvider[],
  configuredTypes: new Set<string>(),
}))

// Whether single sign-on is live comes from plan limits.
vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  isFeatureLive: async (key: string) => key !== 'sso' || state.ssoInPlan,
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => state.providers,
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: async () => state.configuredTypes,
  hasPlatformCredentials: async (type: string) => state.configuredTypes.has(type),
}))

const mockGetWorkspaceSettings = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: (...a: unknown[]) => mockGetWorkspaceSettings(...a),
}))

vi.mock('@quackback/email', () => ({ isEmailConfigured: () => true }))

const { isAuthMethodAllowed, isHardBound } = await import('../auth-restrictions')
const { evaluateProposedSignInMethods } = await import('../sign-in-method-availability')
const { getRegisteredOidcProviderIds } = await import('../registered-providers')

function provider(over: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    id: 'idp_1',
    registrationId: 'sso',
    label: 'Acme SSO',
    enabled: true,
    configured: true,
    domains: [],
    ...over,
  } as IdentityProvider
}

/** Team signs in through the provider only: password and email links off. */
const ssoOnlyOauth = { password: false, magicLink: false }
const ssoOnlyWorkspace = () =>
  makeWorkspace({ authConfig: makeAuthConfig({ oauth: { ...ssoOnlyOauth }, ssoOidc: null }) })

beforeEach(() => {
  state.ssoInPlan = false
  state.providers = [provider()]
  state.configuredTypes = new Set(['auth_sso'])
  mockGetWorkspaceSettings.mockReset()
})

async function magicLinkFor(role: 'admin' | 'member' | 'user') {
  const workspace = ssoOnlyWorkspace()
  const registered = await getRegisteredOidcProviderIds()
  const result = await isAuthMethodAllowed('magic-link', role, registered, workspace)
  return { result, workspace }
}

describe('team sign-in when the plan does not include single sign-on', () => {
  it('lets a team member sign in with an email link, leaving the stored setting off', async () => {
    const { result, workspace } = await magicLinkFor('admin')
    expect(result).toEqual({ allowed: true })
    expect(workspace.authConfig.oauth).toEqual(ssoOnlyOauth)
  })

  it('applies to members and portal users too, since sign-in methods are shared', async () => {
    expect((await magicLinkFor('member')).result).toEqual({ allowed: true })
    expect((await magicLinkFor('user')).result).toEqual({ allowed: true })
  })

  it('keeps password exactly as stored', async () => {
    const workspace = ssoOnlyWorkspace()
    const registered = await getRegisteredOidcProviderIds()
    expect(await isAuthMethodAllowed('credential', 'admin', registered, workspace)).toEqual({
      allowed: false,
      error: 'password_method_not_allowed',
    })
  })

  it('does not open email links when no provider is set up', async () => {
    state.providers = [provider({ enabled: false })]
    expect((await magicLinkFor('admin')).result).toEqual({
      allowed: false,
      error: 'magic_link_method_not_allowed',
    })
  })

  it('does not count a provider whose secret was never saved', async () => {
    state.configuredTypes = new Set()
    expect((await magicLinkFor('admin')).result).toEqual({
      allowed: false,
      error: 'magic_link_method_not_allowed',
    })
  })
})

describe('team sign-in when the plan includes single sign-on', () => {
  it('behaves exactly as stored: email links stay off', async () => {
    state.ssoInPlan = true
    expect((await magicLinkFor('admin')).result).toEqual({
      allowed: false,
      error: 'magic_link_method_not_allowed',
    })
  })

  it('lets the provider itself through', async () => {
    state.ssoInPlan = true
    const registered = await getRegisteredOidcProviderIds()
    expect(await isAuthMethodAllowed('sso', 'admin', registered, ssoOnlyWorkspace())).toEqual({
      allowed: true,
    })
  })
})

describe('"Require SSO" domain rules', () => {
  const enforced = () =>
    provider({
      domains: [makeVerifiedDomain('acme.com', true, { providerId: 'idp_1' as `idp_${string}` })],
    })

  it('do not block an email link when single sign-on is not in the plan', async () => {
    state.providers = [enforced()]
    const registered = await getRegisteredOidcProviderIds(state.providers)
    expect(isHardBound('magic-link', 'jane@acme.com', state.providers, registered)).toBe(false)
  })

  it('still require the provider when single sign-on is in the plan', async () => {
    state.ssoInPlan = true
    state.providers = [enforced()]
    const registered = await getRegisteredOidcProviderIds(state.providers)
    expect(isHardBound('magic-link', 'jane@acme.com', state.providers, registered)).toBe(true)
  })
})

describe('saving sign-in methods while single sign-on is not in the plan', () => {
  it('counts as SSO-only, so break-glass is required, when password and email links go off', async () => {
    // Email links stand in now, so this does not lock anyone out today. But the
    // stored setting is SSO-only, and that is what the workspace becomes the
    // moment the plan includes single sign-on again.
    expect(await evaluateProposedSignInMethods({ ...ssoOnlyOauth })).toEqual({
      leavesNoMethod: false,
      leavesSsoOnly: true,
    })
  })

  it('is not SSO-only while password stays on', async () => {
    expect(await evaluateProposedSignInMethods({ password: true, magicLink: false })).toEqual({
      leavesNoMethod: false,
      leavesSsoOnly: false,
    })
  })

  it('is not SSO-only when no provider is set up', async () => {
    state.providers = [provider({ enabled: false })]
    expect((await evaluateProposedSignInMethods({ ...ssoOnlyOauth })).leavesSsoOnly).toBe(false)
  })
})
