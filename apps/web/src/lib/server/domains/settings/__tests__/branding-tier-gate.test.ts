import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InternalError } from '@/lib/shared/errors'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { OSS_TIER_LIMITS } from '../tier-limits.types'

const hoisted = vi.hoisted(() => {
  const mockDbSet = vi.fn((_values: Record<string, unknown>) => ({ where: vi.fn() }))
  return {
    mockRequireSettings: vi.fn(),
    mockDbSet,
    mockDbUpdate: vi.fn(() => ({ set: mockDbSet })),
  }
})

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

  it('stores a page-saved config it does not model as it was sent', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    const config = {
      preset: 'retired-preset',
      light: { primary: 'color-mix(in oklch, white 40%, black)', radius: '0' },
      dark: { primary: 'var(--brand)', legacyToken: 'lab(52% 40 59)' },
    }
    await expect(updateBrandingConfig(config)).resolves.toEqual(config)
    expect(hoisted.mockDbSet).toHaveBeenCalledWith({ brandingConfig: JSON.stringify(config) })
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

  it('allows stripping generated theme declarations from stored CSS when the feature is off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customCss: false },
    })
    const stored = ':root { --primary: oklch(0.5 0.2 250); }\n.brand { color: red; }\n'
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x', customCss: stored })
    await expect(updateCustomCss('.brand { color: red; }')).resolves.toBe('.brand { color: red; }')
  })

  it('rejects adding extra rules when the feature is off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customCss: false },
    })
    hoisted.mockRequireSettings.mockResolvedValue({
      id: 'org_x',
      customCss: ':root { --primary: oklch(0.5 0.2 250); }\n.brand { color: red; }\n',
    })
    await expect(
      updateCustomCss('.brand { color: red; }\n.hero { color: blue; }')
    ).rejects.toBeInstanceOf(TierLimitError)
  })
})
