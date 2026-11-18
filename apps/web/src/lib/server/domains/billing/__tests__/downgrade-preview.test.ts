import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ flags: { planLimits: false } as Record<string, boolean> }))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getFeatureFlags: async () => hoisted.flags,
}))
vi.mock('@/lib/server/control-plane/client', () => ({
  fetchBillingCatalogue: async () => {
    throw new Error('offline')
  },
}))

const { loadDowngradePreview } = await import('../downgrade-preview')

const overview = { plan: 'pro', trialPlanId: null } as never

beforeEach(() => {
  hoisted.flags = { planLimits: false }
})

describe('loadDowngradePreview feature copy', () => {
  it('says features are disabled on the change while plan limits are off', async () => {
    const preview = await loadDowngradePreview({ planId: 'free', overview, used: {} })
    expect(preview.featuresDisabled).toContain('Webhooks will be disabled')
    expect(preview.featuresDisabled.join(' ')).not.toMatch(/7 days/)
  })

  it('says features pause after 7 days once plan limits are on', async () => {
    hoisted.flags = { planLimits: true }
    const preview = await loadDowngradePreview({ planId: 'free', overview, used: {} })
    expect(preview.featuresDisabled).toContain('Webhooks pause after 7 days.')
  })
})
