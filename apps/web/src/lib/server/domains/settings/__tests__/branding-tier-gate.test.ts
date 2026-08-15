import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InternalError } from '@/lib/shared/errors'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { OSS_TIER_LIMITS } from '../tier-limits.types'

const hoisted = vi.hoisted(() => ({
  mockRequireSettings: vi.fn(),
  mockDbUpdate: vi.fn(() => ({
    set: () => ({ where: vi.fn() }),
  })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    update: hoisted.mockDbUpdate,
  },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  CACHE_KEYS: { WORKSPACE_SETTINGS: 'settings:workspace', REGISTERED_AUTH_PROVIDERS: 'auth:p' },
}))

vi.mock('../settings.helpers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../settings.helpers')>()
  return {
    ...real,
    requireSettings: hoisted.mockRequireSettings,
    requireSettingsCached: hoisted.mockRequireSettings,
  }
})

vi.mock('../tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

import { updateBrandingConfig, updateCustomCss } from '../settings.media'
import { getTierLimits } from '../tier-limits.service'

describe('updateBrandingConfig — customColors gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x', brandingConfig: null })
  })

  it('throws TierLimitError, not InternalError, when custom colours are off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customColors: false },
    })
    await expect(
      updateBrandingConfig({ light: { primary: 'oklch(0.5 0.1 200)' } })
    ).rejects.toBeInstanceOf(TierLimitError)
    await expect(
      updateBrandingConfig({ light: { primary: 'oklch(0.5 0.1 200)' } })
    ).rejects.not.toBeInstanceOf(InternalError)
  })

  it('allows a preset-only save when custom colours are off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customColors: false },
    })
    await expect(updateBrandingConfig({ preset: 'default' })).resolves.toBeDefined()
  })
})

describe('updateCustomCss — customCss gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x', customCss: '' })
  })

  it('throws TierLimitError, not InternalError, when custom CSS is off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customCss: false },
    })
    await expect(updateCustomCss('.brand { color: red; }')).rejects.toBeInstanceOf(TierLimitError)
    await expect(updateCustomCss('.brand { color: red; }')).rejects.not.toBeInstanceOf(
      InternalError
    )
  })

  it('allows clearing CSS when the feature is off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customCss: false },
    })
    await expect(updateCustomCss('')).resolves.toBe('')
  })
})
