import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DISABLED_CLOUD_CONFIG } from '@/lib/server/domains/settings/cloud/cloud.types'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'
import { ForbiddenError } from '@/lib/shared/errors'

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), cloud: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: mocks.enabled,
}))
vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: mocks.cloud,
}))

import { assertOwnAgentAvailable } from '../availability'

describe('own agent availability', () => {
  beforeEach(() => {
    mocks.enabled.mockResolvedValue(true)
    mocks.cloud.mockResolvedValue(DISABLED_CLOUD_CONFIG)
  })

  it('requires the experimental switch even on self-hosted installs', async () => {
    mocks.enabled.mockResolvedValue(false)
    await expect(assertOwnAgentAvailable()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('keeps self-hosted installs unrestricted after opting in', async () => {
    await expect(assertOwnAgentAvailable()).resolves.toBeUndefined()
  })

  it('does not grant cloud access from a paid plan label', async () => {
    mocks.cloud.mockResolvedValue({
      ...DISABLED_CLOUD_CONFIG,
      enabled: true,
      plan: 'pro',
      entitlements: { ownAgent: false },
    })
    await expect(assertOwnAgentAvailable()).rejects.toBeInstanceOf(EntitlementRequiredError)
  })

  it('honors an explicit control-plane grant independently of the plan label', async () => {
    mocks.cloud.mockResolvedValue({
      ...DISABLED_CLOUD_CONFIG,
      enabled: true,
      plan: 'free',
      entitlements: { ownAgent: true },
    })
    await expect(assertOwnAgentAvailable()).resolves.toBeUndefined()
  })

  it('denies an absent projected grant', async () => {
    mocks.cloud.mockResolvedValue({
      ...DISABLED_CLOUD_CONFIG,
      enabled: true,
      plan: 'enterprise',
      entitlements: {},
    })
    await expect(assertOwnAgentAvailable()).rejects.toBeInstanceOf(EntitlementRequiredError)
  })
})
