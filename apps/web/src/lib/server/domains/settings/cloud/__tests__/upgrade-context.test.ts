import { describe, expect, it } from 'vitest'
import { DISABLED_CLOUD_CONFIG, type CloudConfig } from '../cloud.types'
import { upgradeContextFor } from '../upgrade-context'

function cloud(overrides: Partial<CloudConfig> = {}): CloudConfig {
  return {
    ...DISABLED_CLOUD_CONFIG,
    enabled: true,
    plan: 'free',
    entitlements: {},
    canUpgrade: true,
    ...overrides,
  }
}

describe('upgradeContextFor', () => {
  it('is null when cloud is off or no plan is in force', () => {
    expect(upgradeContextFor(DISABLED_CLOUD_CONFIG)).toBeNull()
    expect(upgradeContextFor(cloud({ plan: null }))).toBeNull()
  })

  it('names the current plan and offers a trial to a Free workspace that can upgrade', () => {
    expect(upgradeContextFor(cloud())).toEqual({
      currentPlan: 'free',
      currentPlanName: 'Free',
      trialActive: false,
      trialEligible: true,
    })
  })

  it('withholds the trial while one is running, on a paid plan, with a live sub, or without canUpgrade', () => {
    expect(upgradeContextFor(cloud({ trialActive: true, plan: 'growth' }))).toMatchObject({
      currentPlan: 'growth',
      currentPlanName: 'Pro',
      trialActive: true,
      trialEligible: false,
    })
    expect(upgradeContextFor(cloud({ plan: 'pro' }))?.trialEligible).toBe(false)
    expect(upgradeContextFor(cloud({ subscriptionStatus: 'active' }))?.trialEligible).toBe(false)
    expect(upgradeContextFor(cloud({ subscriptionStatus: 'past_due' }))?.trialEligible).toBe(false)
    expect(upgradeContextFor(cloud({ canUpgrade: false }))?.trialEligible).toBe(false)
  })

  it('still offers a trial after a canceled subscription on Free', () => {
    expect(upgradeContextFor(cloud({ subscriptionStatus: 'canceled' }))?.trialEligible).toBe(true)
  })
})
