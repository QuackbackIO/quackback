import { describe, expect, it } from 'vitest'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import {
  cataloguePlanFor,
  describeEntitlementUpgrade,
  describePlanUpgrade,
  isPlanRefusal,
  throwIfServerFnFailed,
} from '../describe-upgrade'

const catalogue = {
  plans: [
    { id: 'growth', name: 'Growth', highlights: ['Custom domain'] },
    { id: 'pro', name: 'Pro', highlights: ['Workflows'] },
    { id: 'scale', name: 'Scale', highlights: ['Audit log', 'SSO'] },
  ],
} as BillingCatalogue

describe('describeEntitlementUpgrade', () => {
  it('names the cheapest catalogue plan for each wired key', () => {
    expect(describeEntitlementUpgrade('auditLog')).toMatchObject({
      requiredPlan: 'scale',
      requiredPlanName: 'Scale',
      headline: 'Upgrade to Scale',
      body: 'The audit log is a Scale feature. Upgrade to Scale to enable it.',
    })
    expect(describeEntitlementUpgrade('sso').requiredPlan).toBe('scale')
    expect(describeEntitlementUpgrade('customDomain').requiredPlan).toBe('growth')
    expect(describeEntitlementUpgrade('webhooks').requiredPlan).toBe('growth')
    expect(describeEntitlementUpgrade('workflows').requiredPlan).toBe('pro')
    expect(describeEntitlementUpgrade('mcpServer').requiredPlan).toBe('growth')
    expect(describeEntitlementUpgrade('aiDrafts').requiredPlan).toBe('growth')
  })
})

describe('isPlanRefusal', () => {
  it('recognizes a 402 and the entitlement sentence', () => {
    expect(isPlanRefusal({ statusCode: 402, message: 'locked' })).toBe(true)
    expect(
      isPlanRefusal(new Error('Webhooks are a Growth feature. Upgrade to Growth to enable it.'))
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
    expect(describePlanUpgrade('Data export', 'pro')).toMatchObject({
      requiredPlan: 'pro',
      headline: 'Upgrade to Pro',
      body: 'Data export is a Pro feature. Upgrade to Pro to enable it.',
    })
  })
})

describe('cataloguePlanFor', () => {
  it('returns the billing-page plan row', () => {
    expect(cataloguePlanFor(catalogue, 'scale')?.highlights).toEqual(['Audit log', 'SSO'])
    expect(cataloguePlanFor(catalogue, 'free')).toBeNull()
    expect(cataloguePlanFor(null, 'scale')).toBeNull()
  })
})
