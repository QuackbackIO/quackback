import { describe, expect, it } from 'vitest'
import { billingPlanAction, type CataloguePlanId } from '../plan-action'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'

const unpaidFree: BillingProjectionOverview = {
  plan: 'free',
  planName: 'Free',
  status: null,
  trialActive: false,
  trialExpiresAt: null,
  renewalAt: null,
  cancellationAt: null,
  canUpgrade: true,
  canManageBilling: false,
  purchasablePlans: [
    { id: 'growth', name: 'Growth' },
    { id: 'pro', name: 'Pro' },
    { id: 'scale', name: 'Scale' },
  ],
}

describe('billingPlanAction', () => {
  it('offers a 7-day trial of untried paid plans on Free', () => {
    expect(billingPlanAction('free', unpaidFree).kind).toBe('current')
    expect(billingPlanAction('growth', unpaidFree)).toEqual({ kind: 'trial', planId: 'growth' })
    expect(billingPlanAction('pro', unpaidFree)).toEqual({ kind: 'trial', planId: 'pro' })
  })

  it('does not re-trial a plan already in the ledger', () => {
    expect(billingPlanAction('growth', unpaidFree, ['growth'])).toEqual({
      kind: 'subscribe',
      planId: 'growth',
    })
    expect(billingPlanAction('pro', unpaidFree, ['growth'])).toEqual({
      kind: 'trial',
      planId: 'pro',
    })
  })

  it('ends an active trial via Free and converts other plans via checkout', () => {
    const trialing: BillingProjectionOverview = {
      ...unpaidFree,
      plan: 'growth',
      planName: 'Growth',
      trialActive: true,
      trialExpiresAt: '2026-09-01T00:00:00.000Z',
    }
    expect(billingPlanAction('growth', trialing).kind).toBe('current')
    expect(billingPlanAction('free', trialing).kind).toBe('downgrade')
    expect(billingPlanAction('pro', trialing)).toEqual({ kind: 'subscribe', planId: 'pro' })
  })

  it('switches paid plans and always allows a Free downgrade', () => {
    const paid: BillingProjectionOverview = {
      ...unpaidFree,
      plan: 'growth',
      planName: 'Growth',
      status: 'active',
      canUpgrade: false,
      canManageBilling: true,
      renewalAt: '2026-09-14T00:00:00.000Z',
    }
    expect(billingPlanAction('growth', paid).kind).toBe('current')
    expect(billingPlanAction('pro', paid)).toEqual({ kind: 'switch', planId: 'pro' })
    expect(billingPlanAction('free', paid).kind).toBe('downgrade')
  })

  it('does not let a complimentary grant self-downgrade', () => {
    const grant: BillingProjectionOverview = {
      ...unpaidFree,
      plan: 'scale',
      planName: 'Scale',
      status: null,
      canUpgrade: true,
      canManageBilling: false,
    }
    expect(billingPlanAction('scale', grant).kind).toBe('current')
    expect(billingPlanAction('free', grant).kind).toBe('unavailable')
    expect(billingPlanAction('pro', grant)).toEqual({ kind: 'subscribe', planId: 'pro' })
  })

  it('covers every catalogue id', () => {
    const ids: CataloguePlanId[] = ['free', 'growth', 'pro', 'scale']
    for (const id of ids) {
      expect(billingPlanAction(id, unpaidFree).kind).toBeTruthy()
    }
  })
})
