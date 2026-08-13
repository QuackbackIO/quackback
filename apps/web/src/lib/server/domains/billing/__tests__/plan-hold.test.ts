/**
 * A repricing must not downgrade a paying customer.
 *
 * The failure this pins is a silent one. A price's amount is immutable at the
 * provider, so **any** repricing mints a new price object and retires the old
 * one, while live subscriptions keep billing under the retired id. Nothing on
 * such a subscription resolves through the catalogue, so the snapshot names no
 * plan — and reading "no plan" as "not on a plan" writes Free and the Free
 * tier's limits over a customer who is still being charged.
 *
 * ## What this file asserts, and why it is not the same as the suite it joins
 *
 * The end-to-end coverage of the same rule lives in `upgrade-e2e.db.test.ts`,
 * against a real database. This one is deliberately database-free: the decision
 * is a pure one about which plan a snapshot deserves, and the two write seams
 * are mocked so what is *persisted* can be read directly. Every checkout on a
 * developer machine shares one test database, so a rule this load-bearing
 * should also be provable without contending for it.
 *
 * ## Both directions, because "always hold" would pass on one of them
 *
 * Holding is only correct while the subscription is live. A cancellation, a
 * pause and a deletion each mean the customer genuinely stopped paying, and
 * Free is the honest answer there — so those are asserted too, and they are
 * what stops this file from being satisfied by a rule that never downgrades.
 *
 * Each assertion pins the **plan that results** and the **limits written with
 * it**, not that some branch was taken: a change that moved the plan but left
 * the Free tier's caps in place would still strip the customer in-product.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BILLING_PROVIDER, type BillingConfig } from '../billing.config'
import type { ProviderSubscription } from '../provider/client'
import type { StoredCloudConfig } from '@/lib/shared/db-types'

const state = vi.hoisted(() => ({
  /** What `settings.cloud` holds when the subscription is applied. */
  storedCloud: null as StoredCloudConfig | null,
  /** Patches handed to the cloud-config write seam, in order. */
  cloudWrites: [] as Array<Record<string, unknown>>,
  /** Limit objects handed to the tier-limits write seam, in order. */
  limitWrites: [] as Array<unknown>,
}))

// Only two statements reach the database on this path — the staleness probe
// and the snapshot record — and neither decides a plan. Standing them down
// keeps the decision under test isolated from a shared test database.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
  },
}))

// `resolveCloudConfig` stays REAL: the hold reads the stored plan through it,
// so mocking it would move the thing being tested into the fixture.
vi.mock('@/lib/server/domains/settings/cloud/cloud.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/cloud/cloud.service')>()),
  writeCloudConfig: vi.fn(async (patch: Record<string, unknown>) => {
    state.cloudWrites.push(patch)
    return { changed: true, revision: 1 }
  }),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  requireSettings: vi.fn(async () => ({ cloud: state.storedCloud })),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/tier-limits.write')>()),
  writeTierLimits: vi.fn(async (next: unknown) => {
    state.limitWrites.push(next)
    return { changed: true, managedByConfigFile: false }
  }),
}))

const { applySubscription, toSnapshot } = await import('../subscription')

/**
 * Three plans, so a genuine plan CHANGE is distinguishable from a hold, and
 * each carries a different cap so the limits assertion names one plan only.
 */
const CONFIG: BillingConfig = {
  provider: BILLING_PROVIDER,
  apiKey: 'sk_test_planhold',
  webhookSecret: 'whsec_planhold',
  livemode: false,
  returnUrl: '',
  catalogue: {
    free: { seat: 'price_free_seat', limits: { maxBoards: 2 } },
    pro: {
      seat: 'price_pro_seat',
      liteSeat: 'price_pro_lite',
      outcome: 'price_pro_outcome',
      outcomeMeter: 'meter_planhold',
      limits: { maxBoards: 25 },
    },
    scale: { seat: 'price_scale_seat', limits: { maxBoards: 100 } },
  },
}

const FETCHED_AT = new Date('2026-03-01T12:00:00.000Z')

/** The SEAT price, rotated. `price_pro_seat` is what the catalogue still names. */
const ROTATED_SEAT_PRICE = 'price_pro_seat_v2'

function subscription(overrides: Partial<ProviderSubscription> = {}): ProviderSubscription {
  return {
    id: 'sub_planhold',
    customer: 'cus_planhold',
    status: 'active',
    current_period_end: 1_774_915_200,
    // Seven full seats, billing under the retired price the customer is still
    // being charged at.
    items: { data: [{ id: 'si_seat', quantity: 7, price: { id: ROTATED_SEAT_PRICE } }] },
    ...overrides,
  }
}

/** A workspace that bought Pro, as `settings.cloud` records it. */
function storedCloud(plan: string | null): StoredCloudConfig {
  return {
    enabled: true,
    plan,
    source: 'billing',
    billing: {
      provider: BILLING_PROVIDER,
      customerRef: 'cus_planhold',
      subscriptionRef: 'sub_planhold',
      status: 'active',
      currentPeriodEnd: null,
    },
  }
}

/** The plan and limits actually written, as one object per applied snapshot. */
function written(): Array<{ plan: unknown; limits: unknown }> {
  return state.cloudWrites.map((patch, index) => ({
    plan: patch.plan,
    limits: state.limitWrites[index],
  }))
}

beforeEach(() => {
  state.storedCloud = storedCloud('pro')
  state.cloudWrites = []
  state.limitWrites = []
})

describe('an unresolvable price on a LIVE subscription', () => {
  it('holds the plan the customer is paying for, with that plan’s limits', async () => {
    const snapshot = toSnapshot(subscription(), CONFIG, FETCHED_AT)

    // The reported state, restated as a precondition. Without it "still Pro"
    // could be true because the snapshot resolved Pro all along.
    expect(snapshot.plan).toBeNull()
    expect(snapshot.items).toEqual({})
    expect(snapshot.unaccountedItems).toEqual([
      { itemId: 'si_seat', priceId: ROTATED_SEAT_PRICE, licensed: true },
    ])

    const result = await applySubscription(snapshot, CONFIG)

    expect(result.plan).toBe('pro')
    expect(result.planHeld).toBe(true)
    // Pro, and Pro's caps. A plan written without its limits leaves the
    // customer gated at the Free tier's numbers under a Pro badge.
    expect(written()).toEqual([{ plan: 'pro', limits: { maxBoards: 25 } }])
  })

  it.each(['trialing', 'past_due'] as const)(
    'holds the plan while %s, because those statuses still entitle it',
    async (status) => {
      const snapshot = toSnapshot(subscription({ status }), CONFIG, FETCHED_AT)
      const result = await applySubscription(snapshot, CONFIG)

      expect(result.plan).toBe('pro')
      expect(written()).toEqual([{ plan: 'pro', limits: { maxBoards: 25 } }])
    }
  )
})

describe('a subscription that genuinely ended', () => {
  // The control. Without these, a rule that simply never downgrades would
  // satisfy every assertion above.
  it.each(['canceled', 'paused'] as const)(
    'falls to Free on %s even though the catalogue has also drifted',
    async (status) => {
      const snapshot = toSnapshot(subscription({ status }), CONFIG, FETCHED_AT)

      // The discriminating shape: unresolvable AND unaccounted AND ended. A
      // cancellation whose prices still resolve never consults the status.
      expect(snapshot.plan).toBeNull()
      expect(snapshot.unaccountedItems).toHaveLength(1)

      const result = await applySubscription(snapshot, CONFIG)

      expect(result.plan).toBe('free')
      expect(result.planHeld).toBe(false)
      expect(written()).toEqual([{ plan: 'free', limits: { maxBoards: 2 } }])
    }
  )

  it('falls to Free when the subscription is gone entirely', async () => {
    const result = await applySubscription(null, CONFIG)

    expect(result.plan).toBe('free')
    expect(result.planHeld).toBe(false)
    expect(written()).toEqual([{ plan: 'free', limits: { maxBoards: 2 } }])
  })

  it('falls to Free on an ordinary downgrade, whose prices all resolve', async () => {
    // Nothing is unaccounted here — the subscription moved to the Free seat
    // price and says so. "Is anything unaccounted", not "is the plan null", is
    // what separates a stale catalogue from a customer who stopped paying.
    const snapshot = toSnapshot(
      subscription({
        items: { data: [{ id: 'si_seat', quantity: 7, price: { id: 'price_free_seat' } }] },
      }),
      CONFIG,
      FETCHED_AT
    )
    expect(snapshot.unaccountedItems).toEqual([])

    const result = await applySubscription(snapshot, CONFIG)

    expect(result.plan).toBe('free')
    expect(written()).toEqual([{ plan: 'free', limits: { maxBoards: 2 } }])
  })
})

describe('the hold never outranks what the subscription actually says', () => {
  it('applies an upgrade the customer has paid for, retired line and all', async () => {
    // Moved to Scale while one line is still on a retired price. Writing
    // the stored plan here would ignore an upgrade already being charged for.
    const snapshot = toSnapshot(
      subscription({
        items: {
          data: [
            { id: 'si_biz', quantity: 7, price: { id: 'price_scale_seat' } },
            { id: 'si_lite', quantity: 3, price: { id: 'price_pro_lite_retired' } },
          ],
        },
      }),
      CONFIG,
      FETCHED_AT
    )
    expect(snapshot.plan).toBe('scale')
    expect(snapshot.unaccountedItems).toHaveLength(1)

    const result = await applySubscription(snapshot, CONFIG)

    expect(result.plan).toBe('scale')
    expect(result.planHeld).toBe(false)
    expect(written()).toEqual([{ plan: 'scale', limits: { maxBoards: 100 } }])
  })

  it('falls to Free when only a METERED line is unaccounted', async () => {
    // A metered line carries no quantity and cannot be a seat, so it is no
    // evidence that a seat price was rotated. Holding on it would keep a
    // workspace entitled off a stray usage line.
    const snapshot = toSnapshot(
      subscription({
        items: {
          data: [
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
    expect(snapshot.plan).toBeNull()
    expect(snapshot.unaccountedItems).toEqual([
      { itemId: 'si_usage', priceId: 'price_retired_usage', licensed: false },
    ])

    const result = await applySubscription(snapshot, CONFIG)

    expect(result.plan).toBe('free')
    expect(written()).toEqual([{ plan: 'free', limits: { maxBoards: 2 } }])
  })

  it('falls to Free when there is no stored plan to hold', async () => {
    state.storedCloud = storedCloud(null)
    const snapshot = toSnapshot(subscription(), CONFIG, FETCHED_AT)

    const result = await applySubscription(snapshot, CONFIG)

    expect(result.plan).toBe('free')
    expect(result.planHeld).toBe(false)
    expect(written()).toEqual([{ plan: 'free', limits: { maxBoards: 2 } }])
  })
})
