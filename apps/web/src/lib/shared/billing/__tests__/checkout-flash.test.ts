import { describe, expect, it } from 'vitest'
import { checkoutSuccessCopy } from '../checkout-flash'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'

const catalogue = {
  plans: [
    {
      id: 'pro',
      name: 'Pro',
      rank: 2,
      priceMonthlyCents: 3700,
      priceYearlyCents: 34800,
      billedPer: 'workspace',
      bestFor: '',
      highlights: [],
      recommended: true,
    },
  ],
} as unknown as BillingCatalogue

const overview = {
  plan: 'pro',
  planName: 'Pro',
  status: 'active',
  trialActive: false,
  seats: { used: 3, pending: 0, members: 3, purchased: null },
} as BillingProjectionOverview

describe('checkoutSuccessCopy', () => {
  it('names the plan after conversion', () => {
    expect(checkoutSuccessCopy(overview, catalogue)).toEqual({
      title: "You're subscribed",
      body: "You're on Pro. You can change this any time.",
    })
  })

  it('falls back while the projection still looks like a trial', () => {
    expect(checkoutSuccessCopy({ ...overview, trialActive: true }, catalogue).body).toMatch(
      /plan and invoices/
    )
  })
})
