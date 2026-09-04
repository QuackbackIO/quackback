import { describe, expect, it } from 'vitest'
import { billingPlanAction, isPlanDowngrade, type CataloguePlanId } from '../plan-action'
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
    { id: 'growth', name: 'Pro' },
    { id: 'pro', name: 'Business' },
    { id: 'scale', name: 'Enterprise' },
  ],
  seats: { used: 1, pending: 0, members: 1, purchased: null },
  ai: null,
  hideBranding: false,
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
      planName: 'Pro',
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
      planName: 'Pro',
      status: 'active',
      canUpgrade: false,
      canManageBilling: true,
      renewalAt: '2026-09-14T00:00:00.000Z',
    }
    expect(billingPlanAction('growth', paid).kind).toBe('current')
    expect(billingPlanAction('pro', paid)).toEqual({ kind: 'switch', planId: 'pro' })
    expect(billingPlanAction('free', paid)).toEqual({ kind: 'downgrade', planId: 'free' })
    expect(billingPlanAction('growth', { ...paid, plan: 'pro', planName: 'Business' })).toEqual({
      kind: 'downgrade',
      planId: 'growth',
    })
  })

  it('ranks a lower plan as a downgrade', () => {
    expect(isPlanDowngrade('scale', 'growth')).toBe(true)
    expect(isPlanDowngrade('growth', 'pro')).toBe(false)
    expect(isPlanDowngrade('pro', 'free')).toBe(true)
    expect(isPlanDowngrade('enterprise', 'business')).toBe(true)
  })

  it('does not let a complimentary grant self-downgrade', () => {
    const grant: BillingProjectionOverview = {
      ...unpaidFree,
      plan: 'scale',
      planName: 'Enterprise',
      status: null,
      canUpgrade: true,
      canManageBilling: false,
    }
    expect(billingPlanAction('scale', grant).kind).toBe('current')
    expect(billingPlanAction('free', grant).kind).toBe('unavailable')
    expect(billingPlanAction('pro', grant)).toEqual({ kind: 'subscribe', planId: 'pro' })
  })

  it('treats an ended trial as choosing a plan, with Free as a gated downgrade', () => {
    const ended: BillingProjectionOverview = {
      ...unpaidFree,
      trialEnded: true,
      trialPlanId: 'pro',
      trialPlanName: 'Business',
      trialExpiresAt: '2026-08-18T00:00:00.000Z',
    }
    expect(billingPlanAction('pro', ended)).toEqual({ kind: 'subscribe', planId: 'pro' })
    expect(billingPlanAction('growth', ended)).toEqual({ kind: 'subscribe', planId: 'growth' })
    expect(billingPlanAction('free', ended).kind).toBe('downgrade')
  })

  it('covers every catalogue id', () => {
    const ids: CataloguePlanId[] = ['free', 'growth', 'pro', 'scale']
    for (const id of ids) {
      expect(billingPlanAction(id, unpaidFree).kind).toBeTruthy()
    }
  })

  it('treats business/enterprise as the current pro/scale actions', () => {
    expect(billingPlanAction('business', unpaidFree)).toEqual(billingPlanAction('pro', unpaidFree))
    expect(billingPlanAction('enterprise', unpaidFree)).toEqual(
      billingPlanAction('scale', unpaidFree)
    )
  })
})
