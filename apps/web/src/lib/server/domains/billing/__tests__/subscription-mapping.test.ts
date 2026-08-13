/**
 * Provider subscription -> product plan.
 *
 * Pure mapping, asserted as whole objects against independently written
 * expectations. A field-by-field `toContain`-style check here would pass
 * while silently dropping the item map or the period end, which are the two
 * things the rest of the module depends on.
 */
import { describe, expect, it } from 'vitest'
import {
  effectivePlan,
  entitlesPlan,
  normalizeStatus,
  toSnapshot,
  UNSUBSCRIBED_PLAN,
} from '../subscription'
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
    scale: { seat: 'price_scale_seat' },
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
      unaccountedItems: [],
      fetchedAt: FETCHED_AT,
    })
  })

  it('records an item whose price is in no plan instead of dropping it', () => {
    // A rotated price. The provider makes a price's amount immutable, so any
    // repricing mints a new price object and retires the old one — while live
    // subscriptions keep billing under the retired id. Dropping such an item
    // makes it invisible, and invisible reads as absent to the seat sync.
    const snapshot = toSnapshot(
      subscription({
        items: {
          data: [
            { id: 'si_seat', quantity: 2, price: { id: 'price_pro_seat' } },
            // Retired: `pro.liteSeat` has since been rotated to a new id.
            { id: 'si_lite', quantity: 3, price: { id: 'price_pro_lite_retired' } },
          ],
        },
      }),
      CONFIG,
      FETCHED_AT
    )
    expect(snapshot.items).toEqual({ fullSeat: { itemId: 'si_seat', quantity: 2 } })
    expect(snapshot.unaccountedItems).toEqual([
      { itemId: 'si_lite', priceId: 'price_pro_lite_retired', licensed: true },
    ])
  })

  it('marks an unaccounted metered item as not licensed', () => {
    // A metered line carries no quantity and cannot be duplicated into a
    // second seat charge, so it must not block seat creation.
    const snapshot = toSnapshot(
      subscription({
        items: {
          data: [
            { id: 'si_seat', quantity: 2, price: { id: 'price_pro_seat' } },
            {
              id: 'si_usage',
              price: { id: 'price_retired_usage', recurring: { usage_type: 'metered' } },
            },
          ],
        },
      }),
      CONFIG,
      FETCHED_AT
    )
    expect(snapshot.unaccountedItems).toEqual([
      { itemId: 'si_usage', priceId: 'price_retired_usage', licensed: false },
    ])
  })

  it('treats an unaccounted item of unreported type as licensed', () => {
    // The conservative reading: guessing "metered" wrongly costs a duplicate
    // charge, guessing "licensed" wrongly costs a skipped creation.
    const snapshot = toSnapshot(
      subscription({
        items: { data: [{ id: 'si_x', quantity: 1, price: { id: 'price_unknown' } }] },
      }),
      CONFIG,
      FETCHED_AT
    )
    expect(snapshot.unaccountedItems).toEqual([
      { itemId: 'si_x', priceId: 'price_unknown', licensed: true },
    ])
  })

  it('reports no plan when no price is in the catalogue', () => {
    const snapshot = toSnapshot(
      subscription({ items: { data: [{ id: 'si_x', quantity: 1, price: { id: 'price_gone' } }] } }),
      CONFIG,
      FETCHED_AT
    )
    expect(snapshot.plan).toBeNull()
    expect(snapshot.items).toEqual({})
    // Unresolved, but not forgotten.
    expect(snapshot.unaccountedItems).toHaveLength(1)
  })

  it('carries a null period end rather than an epoch date', () => {
    const snapshot = toSnapshot(subscription({ current_period_end: null }), CONFIG, FETCHED_AT)
    expect(snapshot.currentPeriodEnd).toBeNull()
  })

  it('reads the cancellation flag', () => {
    expect(
      toSnapshot(subscription({ cancel_at_period_end: true }), CONFIG, FETCHED_AT).cancelAtPeriodEnd
    ).toBe(true)
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

describe('entitlesPlan', () => {
  const base = toSnapshot(subscription(), CONFIG, FETCHED_AT)

  it.each(['active', 'trialing', 'past_due'] as const)('entitles on %s', (status) => {
    expect(entitlesPlan({ ...base, status })).toBe(true)
  })

  it.each(['canceled', 'paused'] as const)('does not entitle on %s', (status) => {
    expect(entitlesPlan({ ...base, status })).toBe(false)
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
