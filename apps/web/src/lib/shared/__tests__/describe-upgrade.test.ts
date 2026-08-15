import { describe, expect, it } from 'vitest'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import {
  cataloguePlanFor,
  describeEntitlementUpgrade,
  describePlanUpgrade,
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
