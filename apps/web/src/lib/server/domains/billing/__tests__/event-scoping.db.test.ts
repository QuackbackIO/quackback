/**
 * A webhook may only move THIS workspace's subscription.
 *
 * ## Why this is not a hypothetical
 *
 * Provider webhook endpoints subscribe to event **types**, never to customers.
 * Under one operator account with a per-tenant endpoint URL, every tenant's
 * endpoint receives every other tenant's subscription events — correctly
 * signed for its own endpoint secret, because the secret authenticates the
 * *endpoint*, not the subject.
 *
 * So "is this event about us?" is a question the signature cannot answer and
 * the handler must. Without it, three things follow from one ordinary
 * delivery, and the third is the worst:
 *
 *  1. this workspace's plan silently becomes whatever a stranger bought;
 *  2. this workspace's seat count is pushed onto the stranger's subscription,
 *     changing their invoice;
 *  3. `currentSubscriptionRef()` orders by `updated_at DESC`, so the foreign
 *     row wins and "Manage billing" opens another customer's portal, invoices
 *     and card.
 *
 * Each test below drives the real HMAC path against a real database.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { billingSubscriptionState, billingWebhookEvents, settings } from '@/lib/server/db'
import type { BillingProviderClient } from '../provider/client'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/domains/settings/settings.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/settings/settings.service')>()
  return {
    ...actual,
    getTenantSettings: async () => {
      const db = (await import('@/lib/server/__tests__/db-test-fixture')).testDb
      const row = await db.query.settings.findFirst()
      return row ? { settings: row } : null
    },
  }
})

const { handleBillingWebhook } = await import('../webhook.service')
const { signWebhookPayload } = await import('../provider/signature')
const { getBillingConfig, resetBillingConfigCache } = await import('../billing.config')
const { applySubscription, currentSubscriptionRef, toSnapshot } = await import('../subscription')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ cloud: settings.cloud }).from(settings).limit(0)
    await db
      .select({ ref: billingSubscriptionState.subscriptionRef })
      .from(billingSubscriptionState)
      .limit(0)
  },
})

const SECRET = 'whsec_scoping'
const MINE = { customer: 'cus_mine', subscription: 'sub_mine' }
const OTHER = { customer: 'cus_other_tenant', subscription: 'sub_other_tenant' }

const CATALOGUE = {
  free: { seat: 'price_free' },
  pro: { seat: 'price_pro_seat', limits: { maxBoards: 25 } },
  business: { seat: 'price_biz_seat', limits: { maxBoards: 100 } },
}

interface Calls {
  fetched: string[]
  pushes: string[]
}

function stub(calls: Calls, plan: 'pro' | 'business', customer: string, ref: string): BillingProviderClient {
  return {
    getSubscription: vi.fn(async (id: string) => {
      calls.fetched.push(id)
      return {
        id: ref,
        customer,
        status: 'active',
        current_period_end: 1_774_915_200,
        items: {
          data: [
            {
              id: 'si_seat',
              quantity: 1,
              price: { id: plan === 'pro' ? 'price_pro_seat' : 'price_biz_seat' },
            },
          ],
        },
      }
    }),
    updateSubscriptionItems: vi.fn(async (id: string, items: Array<{ quantity?: number }>) => {
      calls.pushes.push(`${id}:${JSON.stringify(items)}`)
      return { id, customer, status: 'active', items: { data: [] } }
    }),
    reportMeterEvent: vi.fn(),
    createCustomer: vi.fn(),
    getCustomer: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    listInvoices: vi.fn(async () => []),
    listPaymentMethods: vi.fn(async () => []),
  } as unknown as BillingProviderClient
}

function deliver(body: Record<string, unknown>, client: BillingProviderClient) {
  const raw = JSON.stringify(body)
  const now = new Date()
  return handleBillingWebhook(
    raw,
    signWebhookPayload(raw, SECRET, Math.floor(now.getTime() / 1000)),
    { client, now }
  )
}

function subscriptionEvent(id: string, subscriptionRef: string, customer: string) {
  return {
    id,
    type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: subscriptionRef, customer } },
  }
}

async function storedCloud(): Promise<Record<string, unknown> | null> {
  const row = await testDb.query.settings.findFirst()
  return (row?.cloud ?? null) as Record<string, unknown> | null
}

beforeEach(async () => {
  await fixture.begin()
  await testDb.delete(billingWebhookEvents)
  await testDb.delete(billingSubscriptionState)
  await testDb.insert(settings).values({
    name: 'Scoping',
    slug: `scoping-${createId('workspace')}`,
    createdAt: new Date(),
  })
  process.env.BILLING_API_KEY = 'sk_test_scoping'
  process.env.BILLING_WEBHOOK_SECRET = SECRET
  process.env.BILLING_PRICES = JSON.stringify(CATALOGUE)
  resetBillingConfigCache()

  // This workspace is on Pro as cus_mine.
  const config = getBillingConfig()!
  await applySubscription(
    toSnapshot(
      {
        id: MINE.subscription,
        customer: MINE.customer,
        status: 'active',
        current_period_end: 1_774_915_200,
        items: { data: [{ id: 'si_seat', quantity: 1, price: { id: 'price_pro_seat' } }] },
      },
      config,
      new Date()
    ),
    config
  )
})

afterEach(async () => {
  await fixture.rollback()
  delete process.env.BILLING_API_KEY
  delete process.env.BILLING_WEBHOOK_SECRET
  delete process.env.BILLING_PRICES
  resetBillingConfigCache()
  vi.clearAllMocks()
})

afterAll(async () => {
  await fixture.close()
})

describe.skipIf(!fixture.available)('webhook customer scoping', () => {
  it('starts on Pro as this workspace, so the checks below are not vacuous', async () => {
    expect(await storedCloud()).toMatchObject({
      plan: 'pro',
      billing: { customerRef: MINE.customer, subscriptionRef: MINE.subscription },
    })
  })

  it('refuses a correctly-signed event for a different customer', async () => {
    const calls: Calls = { fetched: [], pushes: [] }
    const result = await deliver(
      subscriptionEvent('evt_foreign', OTHER.subscription, OTHER.customer),
      stub(calls, 'business', OTHER.customer, OTHER.subscription)
    )

    // Acknowledged — the delivery is legitimate, it is simply not ours, and a
    // non-2xx would make the provider retry it forever.
    expect(result).toEqual({
      status: 200,
      body: { received: true, handled: false, foreign: true },
    })

    // 1. The plan did not move.
    expect(await storedCloud()).toMatchObject({
      plan: 'pro',
      billing: { customerRef: MINE.customer, subscriptionRef: MINE.subscription },
    })
    // 2. Nothing was pushed onto the stranger's subscription.
    expect(calls.pushes).toEqual([])
    // 3. No second row, so "Manage billing" cannot resolve to the stranger.
    const rows = await testDb
      .select({ ref: billingSubscriptionState.subscriptionRef })
      .from(billingSubscriptionState)
    expect(rows.map((r) => r.ref)).toEqual([MINE.subscription])
    expect(await currentSubscriptionRef()).toMatchObject({
      subscriptionRef: MINE.subscription,
      customerRef: MINE.customer,
    })
  })

  it('checks the customer on the AUTHORITATIVE object, not the event payload', async () => {
    // A payload claiming our customer while the real subscription belongs to
    // someone else must not pass. The check therefore has to run after the
    // re-fetch, on what the provider says the subscription actually is.
    const calls: Calls = { fetched: [], pushes: [] }
    const result = await deliver(
      // Payload lies: says cus_mine.
      subscriptionEvent('evt_spoofed', OTHER.subscription, MINE.customer),
      // Provider tells the truth: sub_other_tenant belongs to cus_other_tenant.
      stub(calls, 'business', OTHER.customer, OTHER.subscription)
    )
    expect(result.body).toMatchObject({ handled: false, foreign: true })
    expect(calls.fetched).toEqual([OTHER.subscription])
    expect(calls.pushes).toEqual([])
    expect(await storedCloud()).toMatchObject({ plan: 'pro' })
  })

  it('still handles an event for this workspace', async () => {
    // The inverse assertion. "Refuses everything" would satisfy the tests
    // above and break the product.
    const calls: Calls = { fetched: [], pushes: [] }
    const result = await deliver(
      subscriptionEvent('evt_mine', MINE.subscription, MINE.customer),
      stub(calls, 'business', MINE.customer, MINE.subscription)
    )
    expect(result).toEqual({ status: 200, body: { received: true, handled: true } })
    expect(await storedCloud()).toMatchObject({
      plan: 'business',
      billing: { customerRef: MINE.customer, subscriptionRef: MINE.subscription },
    })
    expect(calls.pushes).toHaveLength(1)
    expect(calls.pushes[0]).toContain(MINE.subscription)
  })

  it('refuses a deletion for a different customer', async () => {
    // The deletion path is the one case that cannot re-fetch, so it needs its
    // own check — and it is the most damaging one to get wrong, because it
    // downgrades the workspace to Free.
    const calls: Calls = { fetched: [], pushes: [] }
    const raw = {
      id: 'evt_foreign_delete',
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: OTHER.subscription, customer: OTHER.customer } },
    }
    const result = await deliver(raw, stub(calls, 'business', OTHER.customer, OTHER.subscription))
    expect(result.body).toMatchObject({ handled: false, foreign: true })
    expect(await storedCloud()).toMatchObject({ plan: 'pro' })
    expect(await currentSubscriptionRef()).toMatchObject({ subscriptionRef: MINE.subscription })
  })

  it('handles a deletion for this workspace', async () => {
    const calls: Calls = { fetched: [], pushes: [] }
    const raw = {
      id: 'evt_my_delete',
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: MINE.subscription, customer: MINE.customer } },
    }
    const result = await deliver(raw, stub(calls, 'pro', MINE.customer, MINE.subscription))
    expect(result).toEqual({ status: 200, body: { received: true, handled: true } })
    expect(await storedCloud()).toMatchObject({ plan: 'free' })
    expect(await currentSubscriptionRef()).toBeNull()
  })

  it('adopts the first subscription when the workspace has none yet', async () => {
    // Checkout completes before any reference is stored, so the very first
    // event has nothing to compare against. That is the one case where an
    // unknown customer is legitimately ours — and it is why the check cannot
    // simply be "reject anything unrecognised".
    await testDb.delete(billingSubscriptionState)
    await testDb.update(settings).set({ cloud: null })

    const calls: Calls = { fetched: [], pushes: [] }
    const result = await deliver(
      subscriptionEvent('evt_first', MINE.subscription, MINE.customer),
      stub(calls, 'pro', MINE.customer, MINE.subscription)
    )
    expect(result).toEqual({ status: 200, body: { received: true, handled: true } })
    expect(await storedCloud()).toMatchObject({
      plan: 'pro',
      billing: { customerRef: MINE.customer },
    })
  })

  it('does not adopt a stranger once this workspace has a customer', async () => {
    // The adoption window closes as soon as a customer is known — otherwise
    // the first-subscription carve-out would reopen the whole hole.
    const calls: Calls = { fetched: [], pushes: [] }
    await deliver(
      subscriptionEvent('evt_intruder', OTHER.subscription, OTHER.customer),
      stub(calls, 'business', OTHER.customer, OTHER.subscription)
    )
    expect(await storedCloud()).toMatchObject({
      billing: { customerRef: MINE.customer },
    })
  })

  it('records a foreign event as consumed, so it is not re-fetched forever', async () => {
    const calls: Calls = { fetched: [], pushes: [] }
    await deliver(
      subscriptionEvent('evt_foreign_twice', OTHER.subscription, OTHER.customer),
      stub(calls, 'business', OTHER.customer, OTHER.subscription)
    )
    const second = await deliver(
      subscriptionEvent('evt_foreign_twice', OTHER.subscription, OTHER.customer),
      stub(calls, 'business', OTHER.customer, OTHER.subscription)
    )
    expect(second.body).toMatchObject({ duplicate: true })
    // One fetch total: the redelivery short-circuits on the event ledger.
    expect(calls.fetched).toEqual([OTHER.subscription])
  })
})
