import { describe, expect, it } from 'vitest'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import {
  cataloguePlanFor,
  describeEntitlementUpgrade,
  describePlanRefusal,
  describePlanUpgrade,
  isPlanRefusal,
  throwIfServerFnFailed,
  unlockedHighlights,
  upgradeLead,
} from '../describe-upgrade'

const catalogue = {
  plans: [
    { id: 'free', name: 'Free', rank: 0, highlights: ['1 seat'] },
    { id: 'growth', name: 'Pro', rank: 1, highlights: ['Custom domain'] },
    { id: 'business', name: 'Business', rank: 2, highlights: ['Workflows'] },
    { id: 'enterprise', name: 'Enterprise', rank: 3, highlights: ['Audit log', 'SSO'] },
  ],
} as BillingCatalogue

describe('describeEntitlementUpgrade', () => {
  it('names the cheapest catalogue plan for each wired key', () => {
    expect(describeEntitlementUpgrade('auditLog')).toMatchObject({
      requiredPlan: 'enterprise',
      requiredPlanName: 'Enterprise',
      headline: 'The audit log is available from the Enterprise plan',
      body: 'The audit log is an Enterprise feature. Upgrade to Enterprise to enable it.',
    })
    expect(describeEntitlementUpgrade('webhooks')).toMatchObject({
      headline: 'Webhooks are available from the Pro plan',
      body: 'Webhooks are a Pro feature. Upgrade to Pro to enable them.',
    })
    expect(describeEntitlementUpgrade('sso').requiredPlan).toBe('enterprise')
    expect(describeEntitlementUpgrade('customDomain').requiredPlan).toBe('growth')
    expect(describeEntitlementUpgrade('webhooks').requiredPlan).toBe('growth')
    expect(describeEntitlementUpgrade('workflows').requiredPlan).toBe('business')
    expect(describeEntitlementUpgrade('mcpServer').requiredPlan).toBe('growth')
    expect(describeEntitlementUpgrade('aiDrafts').requiredPlan).toBe('growth')
    expect(describeEntitlementUpgrade('aiInsights').requiredPlan).toBe('growth')
  })
})

describe('isPlanRefusal', () => {
  it('recognizes a 402 and the entitlement sentence', () => {
    expect(isPlanRefusal({ statusCode: 402, message: 'locked' })).toBe(true)
    expect(
      isPlanRefusal(new Error('Webhooks are a Pro feature. Upgrade to Pro to enable it.'))
    ).toBe(true)
    expect(isPlanRefusal(new Error('boom'))).toBe(false)
    expect(isPlanRefusal(null)).toBe(false)
  })

  it('recognizes a tier-feature sentence with no plan name', () => {
    expect(
      isPlanRefusal(
        new Error('Custom colours is not available on your plan. Upgrade to enable it.')
      )
    ).toBe(true)
    expect(isPlanRefusal({ error: 'tier_limit_exceeded', message: 'locked' })).toBe(true)
  })
})

describe('throwIfServerFnFailed', () => {
  it('throws a plan refusal out of a 200 server-fn envelope', () => {
    expect(() =>
      throwIfServerFnFailed({
        error: true,
        message: 'Custom CSS is not available on your plan. Upgrade to enable it.',
      })
    ).toThrow(/Custom CSS is not available/)
  })

  it('leaves a successful payload alone', () => {
    expect(() => throwIfServerFnFailed({ preset: 'cozy' })).not.toThrow()
    expect(() => throwIfServerFnFailed(undefined)).not.toThrow()
  })
})

describe('describePlanUpgrade', () => {
  it('builds the same sentence shape for a named feature', () => {
    expect(describePlanUpgrade('Data export', 'business')).toMatchObject({
      requiredPlan: 'business',
      headline: 'Data export is available from the Business plan',
      body: 'Data export is a Business feature. Upgrade to Business to enable it.',
    })
  })

  it('takes a plural verb when asked', () => {
    expect(describePlanUpgrade('Integrations', 'business', { plural: true })).toMatchObject({
      headline: 'Integrations are available from the Business plan',
      body: 'Integrations are a Business feature. Upgrade to Business to enable them.',
    })
  })
})

describe('describePlanRefusal', () => {
  const fallback = describePlanUpgrade('Custom colours', 'business', { plural: true })

  it('names the feature and plan from an entitlement refusal', () => {
    expect(
      describePlanRefusal(
        new Error(
          'Workflows are a Business feature. Your workspace is on Pro. Upgrade to Business to enable it.'
        ),
        fallback
      )
    ).toMatchObject({ feature: 'Workflows', requiredPlan: 'business' })
  })

  it('names the feature from a tier refusal and keeps the fallback plan', () => {
    expect(
      describePlanRefusal(
        new Error('Custom CSS is not available on your plan. Upgrade to enable it.'),
        fallback
      )
    ).toMatchObject({
      feature: 'Custom CSS',
      requiredPlan: 'business',
      headline: 'Custom CSS is available from the Business plan',
    })
  })

  it('keeps the fallback for anything else', () => {
    expect(describePlanRefusal(new Error('boom'), fallback)).toBe(fallback)
    expect(describePlanRefusal(null, fallback)).toBe(fallback)
  })
})

describe('upgradeLead', () => {
  it('names both ends of the move when the current plan is known', () => {
    expect(upgradeLead('Free', 'Business')).toBe('Upgrade from Free to Business to unlock:')
    expect(upgradeLead(null, 'Business')).toBe('Upgrade to Business to unlock:')
    expect(upgradeLead('Business', 'Business')).toBe('Upgrade to Business to unlock:')
    expect(upgradeLead('Free', null)).toBe('Upgrade your plan to unlock:')
  })

  it('acknowledges a running trial', () => {
    expect(upgradeLead('Pro', 'Business', { trialActive: true })).toBe(
      "You're trialing Pro. Upgrade to Business to unlock:"
    )
  })
})

describe('unlockedHighlights', () => {
  it('lists the target plan and everything in between, cheapest first', () => {
    expect(unlockedHighlights(catalogue, 'free', 'enterprise')).toEqual({
      target: ['Audit log', 'SSO'],
      included: [
        { planName: 'Pro', highlights: ['Custom domain'] },
        { planName: 'Business', highlights: ['Workflows'] },
      ],
    })
    expect(unlockedHighlights(catalogue, 'growth', 'business')).toEqual({
      target: ['Workflows'],
      included: [],
    })
  })

  it('shows only the target when the current plan is unknown or the catalogue is missing', () => {
    expect(unlockedHighlights(catalogue, null, 'enterprise')).toEqual({
      target: ['Audit log', 'SSO'],
      included: [],
    })
    expect(unlockedHighlights(null, 'free', 'enterprise')).toEqual({ target: [], included: [] })
  })
})

describe('cataloguePlanFor', () => {
  it('returns the billing-page plan row', () => {
    expect(cataloguePlanFor(catalogue, 'enterprise')?.highlights).toEqual(['Audit log', 'SSO'])
    expect(cataloguePlanFor(catalogue, 'free')?.id).toBe('free')
    expect(cataloguePlanFor(null, 'enterprise')).toBeNull()
  })
})
