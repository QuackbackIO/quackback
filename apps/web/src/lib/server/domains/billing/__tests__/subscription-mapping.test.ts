/**
 * Provider subscription -> product plan.
 *
 * Pure mapping, asserted as whole objects against independently written
 * expectations. A field-by-field `toContain`-style check here would pass
 * while silently dropping the item map or the period end, which are the two
 * things the rest of the module depends on.
 */
import { describe, expect, it } from 'vitest'
import { effectivePlan, normalizeStatus, toSnapshot, UNSUBSCRIBED_PLAN } from '../subscription'
import { BILLING_PROVIDER, type BillingConfig } from '../billing.config'
import type { ProviderSubscription } from '../provider/client'

const CONFIG: BillingConfig = {
  provider: BILLING_PROVIDER,
  apiKey: 'sk_test_x',
  webhookSecret: 'whsec_x',
  livemode: false,
  returnUrl: '',
  catalogue: {
    pro: {
      seat: 'price_pro_seat',
      liteSeat: 'price_pro_lite',
      copilotSeat: 'price_pro_copilot',
      outcome: 'price_pro_outcome',
      outcomeMeter: 'meter_outcome',
    },
    business: { seat: 'price_biz_seat' },
  },
}

const FETCHED_AT = new Date('2026-03-01T12:00:00.000Z')

function subscription(overrides: Partial<ProviderSubscription> = {}): ProviderSubscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    // 2026-04-01T00:00:00Z
    current_period_end: 1_774_915_200,
    items: {
      data: [
        { id: 'si_seat', quantity: 4, price: { id: 'price_pro_seat' } },
        { id: 'si_lite', quantity: 2, price: { id: 'price_pro_lite' } },
        { id: 'si_outcome', price: { id: 'price_pro_outcome' } },
      ],
    },
    ...overrides,
  }
}

describe('toSnapshot', () => {
  it('maps a subscription whole', () => {
    expect(toSnapshot(subscription(), CONFIG, FETCHED_AT)).toEqual({
      subscriptionRef: 'sub_1',
      customerRef: 'cus_1',
      status: 'active',
      plan: 'pro',
      currentPeriodEnd: new Date(1_774_915_200 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      items: {
        fullSeat: { itemId: 'si_seat', quantity: 4 },
        liteSeat: { itemId: 'si_lite', quantity: 2 },
        // A metered item carries no quantity; it must map to 0, not undefined,
        // or the seat sync would treat "no quantity" as a change to push.
        resolvedOutcome: { itemId: 'si_outcome', quantity: 0 },
      },
      fetchedAt: FETCHED_AT,
    })
  })

  it('reports no plan when no price is in the catalogue', () => {
    const snapshot = toSnapshot(
      subscription({ items: { data: [{ id: 'si_x', quantity: 1, price: { id: 'price_gone' } }] } }),
      CONFIG,
      FETCHED_AT
    )
    expect(snapshot.plan).toBeNull()
    expect(snapshot.items).toEqual({})
  })

  it('carries a null period end rather than an epoch date', () => {
    const snapshot = toSnapshot(
      subscription({ current_period_end: null }),
      CONFIG,
      FETCHED_AT
    )
    expect(snapshot.currentPeriodEnd).toBeNull()
  })

  it('reads the cancellation flag', () => {
    expect(toSnapshot(subscription({ cancel_at_period_end: true }), CONFIG, FETCHED_AT)
      .cancelAtPeriodEnd).toBe(true)
  })
})

describe('normalizeStatus', () => {
  it.each([
    ['active', 'active'],
    ['trialing', 'trialing'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['incomplete', 'past_due'],
    ['incomplete_expired', 'canceled'],
    ['canceled', 'canceled'],
    ['paused', 'paused'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeStatus(input)).toBe(expected)
  })

  it('maps an unknown status to past_due, not to active', () => {
    // The direction matters: an unrecognised status is one this code cannot
    // confirm as paid, so it must not read as a confirmed payment. It still
    // entitles the plan, so a vendor adding a status cannot cut customers off.
    expect(normalizeStatus('some_future_status')).toBe('past_due')
  })
})

describe('effectivePlan', () => {
  const base = toSnapshot(subscription(), CONFIG, FETCHED_AT)

  it('grants the plan while active', () => {
    expect(effectivePlan(base)).toBe('pro')
  })

  it('grants the plan during a trial', () => {
    expect(effectivePlan({ ...base, status: 'trialing' })).toBe('pro')
  })

  it('keeps the plan while payment is overdue', () => {
    // A failed renewal is a commercial problem, not an abuse signal. The
    // provider's dunning cycle ends in `canceled`, which does downgrade.
    expect(effectivePlan({ ...base, status: 'past_due' })).toBe('pro')
  })

  it.each(['canceled', 'paused'] as const)('downgrades on %s', (status) => {
    expect(effectivePlan({ ...base, status })).toBe(UNSUBSCRIBED_PLAN)
  })

  it('downgrades when there is no subscription at all', () => {
    expect(effectivePlan(null)).toBe(UNSUBSCRIBED_PLAN)
  })

  it('downgrades when the subscription names no known plan', () => {
    expect(effectivePlan({ ...base, plan: null })).toBe(UNSUBSCRIBED_PLAN)
  })
})
