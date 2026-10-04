import { describe, expect, it } from 'vitest'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import { aiCreditsState, copilotCreditsOffer } from '../ai-credits'

const catalogue = {
  version: 1,
  currency: 'usd',
  annualDiscountMonths: 2,
  recommendedPlanId: 'pro',
  brandingRemoval: { monthlyCents: 0, annualCents: 0 },
  aiIncludedCentsPerMonth: { free: 0, pro: 500, business: 2000 },
  aiTopUpPackCents: 1000,
  plans: [
    {
      id: 'business',
      name: 'Business',
      rank: 3,
      priceMonthlyCents: 4900,
      priceYearlyCents: 0,
      billedPer: 'seat',
      bestFor: '',
      highlights: [],
      recommended: false,
    },
    {
      id: 'free',
      name: 'Free',
      rank: 1,
      priceMonthlyCents: 0,
      priceYearlyCents: 0,
      billedPer: 'workspace',
      bestFor: '',
      highlights: [],
      recommended: false,
    },
    {
      id: 'pro',
      name: 'Pro',
      rank: 2,
      priceMonthlyCents: 2400,
      priceYearlyCents: 0,
      billedPer: 'seat',
      bestFor: '',
      highlights: [],
      recommended: true,
    },
  ],
} as unknown as BillingCatalogue

describe('AI credits', () => {
  it('are available with no cap, or while usage is under it, trials included', () => {
    expect(aiCreditsState(null, 10_000_000)).toBe('available')
    expect(aiCreditsState(1_000, 999)).toBe('available')
  })

  it('are none on a plan without AI and used once the cap is reached', () => {
    expect(aiCreditsState(0, 0)).toBe('none')
    expect(aiCreditsState(1_000, 1_000)).toBe('used')
  })
})

describe('the Copilot credits offer', () => {
  it('names the cheapest plan that includes AI, at the catalogue price', () => {
    expect(copilotCreditsOffer(catalogue, 'none')).toEqual({
      kind: 'plan',
      planName: 'Pro',
      priceCents: 2400,
      perSeat: true,
    })
  })

  it('offers a top-up pack once this month is used up', () => {
    expect(copilotCreditsOffer(catalogue, 'used')).toEqual({ kind: 'topUp', priceCents: 1000 })
  })

  it('names no price without a catalogue', () => {
    expect(copilotCreditsOffer(null, 'none')).toBeNull()
    expect(copilotCreditsOffer({ ...catalogue, aiTopUpPackCents: undefined }, 'used')).toBeNull()
  })
})
