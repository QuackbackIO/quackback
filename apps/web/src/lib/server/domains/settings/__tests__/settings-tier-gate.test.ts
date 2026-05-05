import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  mockRequireSettings: vi.fn(),
  mockDbUpdate: vi.fn(() => ({
    set: () => ({ where: vi.fn() }),
  })),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: { update: hoisted.mockDbUpdate },
  settings: { id: 'id' },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/redis', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  CACHE_KEYS: { SETTINGS: 's' },
}))

vi.mock('../settings.helpers', () => ({
  requireSettings: hoisted.mockRequireSettings,
  parseJsonConfig: <T>(_raw: string | null, def: T): T => def,
  invalidateSettingsCache: vi.fn(),
  wrapDbError: (_msg: string, err: unknown) => {
    throw err
  },
  deepMerge: <T>(a: T, b: Partial<T>) => ({ ...a, ...b }),
}))

import { updateAuthConfig, updateDeveloperConfig } from '../settings.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('updateDeveloperConfig — mcpServer gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x', developerConfig: null })
  })

  it('throws TierLimitError when enabling mcpEnabled with feature off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, mcpServer: false },
    })
    await expect(updateDeveloperConfig({ mcpEnabled: true })).rejects.toBeInstanceOf(TierLimitError)
  })

  it('allows mcpEnabled: true when feature is on (OSS default)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    await expect(updateDeveloperConfig({ mcpEnabled: true })).resolves.toBeDefined()
  })

  it('allows mcpEnabled: false even when feature is off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, mcpServer: false },
    })
    // Disabling MCP should always be allowed.
    await expect(updateDeveloperConfig({ mcpEnabled: false })).resolves.toBeDefined()
  })
})

describe('updateAuthConfig — customOidcProvider gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x', authConfig: null })
  })

  it('allows standard providers (google, github, microsoft, discord) when feature off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
    })
    await expect(
      updateAuthConfig({
        oauth: { google: true, github: true, microsoft: true, discord: true },
      })
    ).resolves.toBeDefined()
  })

  it('throws TierLimitError when enabling a non-standard provider with feature off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
    })
    await expect(updateAuthConfig({ oauth: { google: true, okta: true } })).rejects.toBeInstanceOf(
      TierLimitError
    )
  })

  it('allows a non-standard provider when feature is on (OSS default)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    await expect(updateAuthConfig({ oauth: { google: true, okta: true } })).resolves.toBeDefined()
  })
})
