import { describe, expect, it } from 'vitest'
import {
  composeAiUsage,
  purchasedSeatsFromProjection,
  trialPlanIdForOverview,
} from '../projection-overview'

describe('composeAiUsage', () => {
  it('converts tokens at the catalogue blended rate and derives extra from the cap', () => {
    // $5 / 1M tokens, $30 included = 6M tokens. Cap 8M → $10 extra credit.
    expect(
      composeAiUsage({
        usedTokens: 5_040_000,
        tokenCap: 8_000_000,
        includedCents: 3000,
        blendedCentsPerMTok: 500,
      })
    ).toEqual({
      includedCents: 3000,
      usedCents: 2520,
      extraCents: 1000,
    })
  })

  it('does not invent extra credit when the cap is the included allowance', () => {
    expect(
      composeAiUsage({
        usedTokens: 0,
        tokenCap: 6_000_000,
        includedCents: 3000,
        blendedCentsPerMTok: 500,
      })
    ).toEqual({ includedCents: 3000, usedCents: 0, extraCents: 0 })
  })
})

describe('purchasedSeatsFromProjection', () => {
  const billed = {
    billedPer: 'seat' as const,
    plan: 'business' as const,
    trialActive: false,
    planLimitsMaxTeamSeats: 10,
  }

  it('uses billed planLimits.maxTeamSeats, not an operator overlay', () => {
    // A 10-seat subscription with a 100-seat overlay still shows 10 purchased:
    // the helper is not given the overlay, only the projection quantity.
    expect(purchasedSeatsFromProjection(billed)).toBe(10)
  })

  it('is null for Free, trial, workspace-billed, and missing billedPer', () => {
    expect(purchasedSeatsFromProjection({ ...billed, plan: 'free' })).toBeNull()
    expect(purchasedSeatsFromProjection({ ...billed, trialActive: true })).toBeNull()
    expect(purchasedSeatsFromProjection({ ...billed, billedPer: 'workspace' })).toBeNull()
    expect(purchasedSeatsFromProjection({ ...billed, billedPer: undefined })).toBeNull()
  })
})

describe('trialPlanIdForOverview', () => {
  it('uses the live plan while the product trial is running', () => {
    expect(
      trialPlanIdForOverview({
        trialActive: true,
        trialEnded: false,
        plan: 'growth',
        lastTrialPlanId: 'business',
      })
    ).toBe('growth')
  })

  it('uses lastTrialPlanId only in the ended window', () => {
    expect(
      trialPlanIdForOverview({
        trialActive: false,
        trialEnded: true,
        plan: 'free',
        lastTrialPlanId: 'business',
      })
    ).toBe('business')
  })

  it('ignores historical trial plans on a paid workspace', () => {
    expect(
      trialPlanIdForOverview({
        trialActive: false,
        trialEnded: false,
        plan: 'enterprise',
        lastTrialPlanId: 'growth',
      })
    ).toBeNull()
  })
})
