/**
 * The oauthProvider plugin reads the dynamic-client-registration toggle at
 * auth-instance build time, so flipping it must bump auth_config_version
 * (rebuilding cached Better-Auth instances across pods) and reset the local
 * instance. Unrelated developer-config updates must not churn auth instances.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()
const mockCacheDel = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheDel: (...args: unknown[]) => mockCacheDel(...args),
  CACHE_KEYS: { TENANT_SETTINGS: 'settings:tenant' },
}))

const mockFindFirst = vi.fn()
const mockUpdate = vi.fn((..._args: unknown[]) => ({
  set: () => ({ where: () => Promise.resolve() }),
}))

type SettingsTx = { update: (...args: unknown[]) => unknown }

vi.mock('@/lib/server/db', async (importOriginal) => {
  const tx: SettingsTx = { update: (...args: unknown[]) => mockUpdate(...args) }
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      query: { settings: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } },
      update: (...args: unknown[]) => mockUpdate(...args),
      transaction: async (fn: (tx: SettingsTx) => unknown) => fn(tx),
    },
    eq: vi.fn(),
  }
})

const mockBump = vi.fn()
vi.mock('@/lib/server/auth/config-version', () => ({
  bumpAuthConfigVersionInTx: (...args: unknown[]) => mockBump(...args),
}))

const mockResetAuth = vi.fn()
vi.mock('@/lib/server/auth', () => ({
  resetAuth: (...args: unknown[]) => mockResetAuth(...args),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: () => null,
  deleteObject: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  assertTierFeature: vi.fn(),
}))

const { updateDeveloperConfig } = await import('../settings.service')

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirst.mockResolvedValue({
    id: 'settings_1',
    developerConfig: null,
  })
})

describe('updateDeveloperConfig — auth config version bump', () => {
  it('bumps the auth config version when dynamic client registration is toggled', async () => {
    const result = await updateDeveloperConfig({ oauthDynamicClientRegistrationEnabled: false })
    expect(result.oauthDynamicClientRegistrationEnabled).toBe(false)
    expect(mockBump).toHaveBeenCalledTimes(1)
    expect(mockResetAuth).toHaveBeenCalledTimes(1)
    expect(mockCacheDel).toHaveBeenCalled()
  })

  it('does not bump when the toggle is set to its current value', async () => {
    // Default is enabled, so re-enabling is a no-op for the auth instance
    await updateDeveloperConfig({ oauthDynamicClientRegistrationEnabled: true })
    expect(mockBump).not.toHaveBeenCalled()
    expect(mockResetAuth).not.toHaveBeenCalled()
  })

  it('does not bump for unrelated developer-config updates', async () => {
    await updateDeveloperConfig({ mcpEnabled: false })
    expect(mockBump).not.toHaveBeenCalled()
    expect(mockResetAuth).not.toHaveBeenCalled()
  })

  it('defaults the toggle to enabled (current behavior preserved)', async () => {
    const result = await updateDeveloperConfig({ mcpEnabled: true })
    expect(result.oauthDynamicClientRegistrationEnabled).toBe(true)
  })
})
