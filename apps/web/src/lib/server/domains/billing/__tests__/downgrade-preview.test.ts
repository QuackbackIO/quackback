import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/control-plane/client', () => ({
  fetchBillingCatalogue: async () => {
    throw new Error('offline')
  },
}))

const { loadDowngradePreview } = await import('../downgrade-preview')

const overview = { plan: 'pro', trialPlanId: null } as never

describe('loadDowngradePreview feature copy', () => {
  it('says features pause after 7 days, never that the change disables them', async () => {
    const preview = await loadDowngradePreview({ planId: 'free', overview, used: {} })
    expect(preview.featuresDisabled).toContain('Webhooks pause after 7 days.')
    expect(preview.featuresDisabled.join(' ')).not.toMatch(/disabled|revoked/)
  })
})
