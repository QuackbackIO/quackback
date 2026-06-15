import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  mockSavePlatformCredentials: vi.fn(async () => undefined),
  mockGetTierLimits: vi.fn(),
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({ principal: { id: 'principal_admin' } })),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  savePlatformCredentials: hoisted.mockSavePlatformCredentials,
  deletePlatformCredentials: vi.fn(),
  getPlatformCredentials: vi.fn(),
}))

vi.mock('@/lib/server/integrations', () => ({
  getIntegration: vi.fn((type: string) => ({
    integrationType: type,
    platformCredentials: [
      { key: 'clientId', label: 'Client ID', sensitive: false },
      { key: 'clientSecret', label: 'Client Secret', sensitive: true },
    ],
  })),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { savePlatformCredentialsFn } from '../platform-credentials'

const validCreds = { clientId: 'cid', clientSecret: 'secret' }

describe('savePlatformCredentialsFn — integrations gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses save when integrations feature is off', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, integrations: false },
    })

    await expect(
      savePlatformCredentialsFn({
        data: { integrationType: 'github', credentials: validCreds },
      })
    ).rejects.toBeInstanceOf(TierLimitError)

    expect(hoisted.mockSavePlatformCredentials).not.toHaveBeenCalled()
  })

  it('allows save when integrations feature is on (Pro+ / OSS default)', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue(OSS_TIER_LIMITS)

    await savePlatformCredentialsFn({
      data: { integrationType: 'github', credentials: validCreds },
    })

    expect(hoisted.mockSavePlatformCredentials).toHaveBeenCalledTimes(1)
  })
})
