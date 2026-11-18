/**
 * The sign-in methods the login forms are offered when the plan no longer
 * includes single sign-on.
 *
 * A workspace set up to sign in only through its identity provider (password
 * and email links off) would show its team an empty form once the provider
 * stops registering. Email links are offered instead, computed at read time:
 * the stored `authConfig.oauth` is never changed, and the offer follows the
 * plan as soon as plan limits do, even when the settings were read from cache
 * before the plan changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkspaceSettings } from '../settings.types'

const state = vi.hoisted(() => ({
  ssoInPlan: false,
  providerEnabled: true,
  cached: null as unknown,
}))

const mockFindFirst = vi.fn()
const mockCacheSet = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@/lib/server/cache', () => ({
  cacheGet: async () => state.cached,
  cacheSet: (...a: unknown[]) => mockCacheSet(...a),
  cacheDel: vi.fn(),
  CACHE_KEYS: { WORKSPACE_SETTINGS: 'settings:workspace' },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { settings: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } },
    update: (...a: unknown[]) => mockUpdate(...a),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
        limit: () => Promise.resolve([]),
        orderBy: () => Promise.resolve([]),
      }),
    }),
  },
  eq: vi.fn(),
}))

vi.mock('@quackback/email', () => ({ isEmailConfigured: () => true }))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: async () => new Set(['auth_sso']),
}))

vi.mock('../tier-limits.service', () => ({
  getTierLimits: async () => ({ features: { customOidcProvider: state.ssoInPlan } }),
}))

// Keep the real visibility predicates; only the DB-backed list is faked.
vi.mock('../identity-providers.service', async (importActual) => {
  const actual = await importActual<typeof import('../identity-providers.service')>()
  return {
    ...actual,
    listIdentityProviders: async () => [
      {
        id: 'idp_1',
        registrationId: 'sso',
        label: 'Acme SSO',
        enabled: state.providerEnabled,
        configured: true,
        showButton: false,
        domains: [],
      },
    ],
  }
})

const { getPublicAuthConfig, getWorkspaceSettings } = await import('../settings.service')

const ssoOnlyOauth = { password: false, magicLink: false }
const settingsRow = {
  id: 's1',
  name: 'Acme',
  slug: 'acme',
  authConfig: JSON.stringify({ oauth: ssoOnlyOauth, openSignup: false }),
  portalConfig: '{}',
  brandingConfig: '{}',
  developerConfig: '{}',
  customCss: '',
  managedFieldPaths: [],
  state: 'active',
  setupState: JSON.stringify({
    version: 1,
    steps: { core: true, workspace: true, boards: true },
  }),
}

beforeEach(() => {
  vi.clearAllMocks()
  state.ssoInPlan = false
  state.providerEnabled = true
  state.cached = null
  mockFindFirst.mockResolvedValue(settingsRow)
})

describe('getPublicAuthConfig', () => {
  it('offers email links when the provider is set up but not in the plan', async () => {
    const config = await getPublicAuthConfig()
    expect(config.oauth.magicLink).toBe(true)
    expect(config.oauth.password).toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('is exactly as stored when the plan includes single sign-on', async () => {
    state.ssoInPlan = true
    const config = await getPublicAuthConfig()
    expect(config.oauth.magicLink).toBe(false)
  })

  it('is exactly as stored when no provider is set up', async () => {
    state.providerEnabled = false
    const config = await getPublicAuthConfig()
    expect(config.oauth.magicLink).toBe(false)
  })
})

describe('getWorkspaceSettings', () => {
  it('offers email links to the login forms and leaves the stored setting off', async () => {
    const settings = await getWorkspaceSettings()
    expect(settings?.publicAuthConfig.oauth.magicLink).toBe(true)
    expect(settings?.authConfig.oauth.magicLink).toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('caches the stored methods, not the fallback', async () => {
    await getWorkspaceSettings()
    const cached = mockCacheSet.mock.calls.find(([key]) => key === 'settings:workspace')?.[1] as
      WorkspaceSettings | undefined
    expect(cached?.publicAuthConfig.oauth.magicLink).toBe(false)
  })

  it('follows the plan on a cache hit written while single sign-on was live', async () => {
    // Read and cached while the plan included single sign-on.
    state.ssoInPlan = true
    const live = await getWorkspaceSettings()
    expect(live?.publicAuthConfig.oauth.magicLink).toBe(false)
    state.cached = mockCacheSet.mock.calls.find(([key]) => key === 'settings:workspace')?.[1]
    expect(state.cached).toBeTruthy()

    // The plan drops it; the cached entry is still served.
    state.ssoInPlan = false
    mockFindFirst.mockClear()
    const after = await getWorkspaceSettings()
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(after?.publicAuthConfig.oauth.magicLink).toBe(true)

    // And back again, with nothing to set up.
    state.ssoInPlan = true
    const restored = await getWorkspaceSettings()
    expect(restored?.publicAuthConfig.oauth.magicLink).toBe(false)
  })

  it('offers nothing extra when no provider is set up, and caches that', async () => {
    state.providerEnabled = false
    const settings = await getWorkspaceSettings()
    expect(settings?.publicAuthConfig.oauth.magicLink).toBe(false)
    const cached = mockCacheSet.mock.calls.find(([key]) => key === 'settings:workspace')?.[1] as
      WorkspaceSettings | undefined
    expect(cached?.ssoProvidersConfigured).toBe(false)
  })

  it('reads the providers live for an entry cached before the flag existed', async () => {
    state.ssoInPlan = true
    await getWorkspaceSettings()
    const legacy = structuredClone(
      mockCacheSet.mock.calls.find(
        ([key]) => key === 'settings:workspace'
      )?.[1] as WorkspaceSettings
    )
    delete legacy.ssoProvidersConfigured
    state.cached = legacy

    state.ssoInPlan = false
    const settings = await getWorkspaceSettings()
    expect(settings?.publicAuthConfig.oauth.magicLink).toBe(true)

    // And still nothing extra when the live read finds no provider.
    state.providerEnabled = false
    expect((await getWorkspaceSettings())?.publicAuthConfig.oauth.magicLink).toBe(false)
  })
})
