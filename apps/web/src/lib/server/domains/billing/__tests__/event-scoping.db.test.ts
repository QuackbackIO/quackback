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
const { BILLING_PROVIDER, getBillingConfig, resetBillingConfigCache } = await import(
  '../billing.config'
)
const { applySubscription, currentSubscriptionRef, toSnapshot } = await import('../subscription')
const { workspaceStamp } = await import('../identity')

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
  customerLookups: string[]
}

/**
 * @param stampedFor Workspace id the customer's provider-side metadata claims
 *   it was created for. `null` models a customer created outside this module
 *   (no stamp), which must never be adopted.
 */
function stub(
  calls: Calls,
  plan: 'pro' | 'business',
  customer: string,
  ref: string,
  stampedFor: string | null = null
): BillingProviderClient {
  return {
    getCustomer: vi.fn(async (id: string) => {
      calls.customerLookups.push(id)
      return {
        id,
        email: null,
        metadata: stampedFor ? { quackback_workspace: stampedFor } : {},
      }
    }),
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
    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
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
    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
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
    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
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
    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
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
    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
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

  it('adopts a first subscription whose customer this workspace created', async () => {
    // Checkout completes at the provider before any reference exists locally,
    // so the very first event has nothing local to compare against. It is
    // resolved AT THE PROVIDER instead: `ensureCustomer()` stamps the
    // workspace id into the customer's metadata, and adoption requires it to
    // match. Rejecting outright would make self-serve signup impossible.
    await testDb.delete(billingSubscriptionState)
    await testDb.update(settings).set({ cloud: null })
    const workspaceId = await workspaceStamp()

    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
    const result = await deliver(
      subscriptionEvent('evt_first', MINE.subscription, MINE.customer),
      stub(calls, 'pro', MINE.customer, MINE.subscription, workspaceId)
    )
    expect(result).toEqual({ status: 200, body: { received: true, handled: true } })
    expect(calls.customerLookups).toEqual([MINE.customer])
    expect(await storedCloud()).toMatchObject({
      plan: 'pro',
      billing: { customerRef: MINE.customer },
    })
  })

  it('refuses to adopt a subscription whose customer carries no workspace stamp', async () => {
    // A customer created outside this module — a provisioning flow that has
    // not been taught the contract, or a stranger's. Refusing is the correct
    // direction for an identity question: a diagnosable failure rather than a
    // silent cross-tenant adoption.
    await testDb.delete(billingSubscriptionState)
    await testDb.update(settings).set({ cloud: null })

    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
    const result = await deliver(
      subscriptionEvent('evt_unstamped', OTHER.subscription, OTHER.customer),
      stub(calls, 'business', OTHER.customer, OTHER.subscription, null)
    )
    expect(result.body).toMatchObject({ handled: false, foreign: true })
    expect(await storedCloud()).toBeNull()
    expect(calls.pushes).toEqual([])
  })

  it('refuses to adopt a subscription stamped for a different workspace', async () => {
    await testDb.delete(billingSubscriptionState)
    await testDb.update(settings).set({ cloud: null })

    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
    const result = await deliver(
      subscriptionEvent('evt_other_ws', OTHER.subscription, OTHER.customer),
      stub(calls, 'business', OTHER.customer, OTHER.subscription, 'workspace_someone_else')
    )
    expect(result.body).toMatchObject({ handled: false, foreign: true })
    expect(await storedCloud()).toBeNull()
  })

  it('does not adopt a stranger once this workspace has a customer', async () => {
    // The adoption window closes as soon as a customer is known — and once it
    // is, the provider is not even consulted.
    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
    await deliver(
      subscriptionEvent('evt_intruder', OTHER.subscription, OTHER.customer),
      // Stamped for US, to make the point: with a customer on record the
      // stamp is irrelevant, because equality already answers the question.
      stub(calls, 'business', OTHER.customer, OTHER.subscription, await workspaceStamp())
    )
    expect(await storedCloud()).toMatchObject({
      billing: { customerRef: MINE.customer },
    })
    expect(calls.customerLookups).toEqual([])
  })

  // ---------------------------------------------------------------------
  // Re-entry: the ways the window was reopened after it had closed
  // ---------------------------------------------------------------------

  it('keeps the customer after a cancellation, so the window does not reopen', async () => {
    // The defect this pins: `applySubscription(null, …)` nulled `customerRef`
    // along with the subscription, so a workspace that had ever cancelled was
    // back to "no customer known" — permanently adoptable. Asserting the
    // WHOLE identity block, because the earlier test asserted only the fields
    // it expected to change and that is precisely where the hole was.
    await deliver(
      {
        id: 'evt_cancel',
        type: 'customer.subscription.deleted',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: MINE.subscription, customer: MINE.customer } },
      },
      stub({ fetched: [], pushes: [], customerLookups: [] }, 'pro', MINE.customer, MINE.subscription)
    )

    const cloud = await storedCloud()
    expect(cloud).toMatchObject({ plan: 'free' })
    expect((cloud as { billing: Record<string, unknown> }).billing).toEqual({
      provider: BILLING_PROVIDER,
      // The customer survives its subscription — commercially true, and what
      // keeps the ownership check able to answer.
      customerRef: MINE.customer,
      subscriptionRef: null,
      status: null,
      currentPeriodEnd: null,
    })
  })

  it('still refuses a foreign event after a cancellation', async () => {
    // The sequence the previous suite never ran: cancel, then deliver.
    await deliver(
      {
        id: 'evt_cancel_2',
        type: 'customer.subscription.deleted',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: MINE.subscription, customer: MINE.customer } },
      },
      stub({ fetched: [], pushes: [], customerLookups: [] }, 'pro', MINE.customer, MINE.subscription)
    )

    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
    const result = await deliver(
      subscriptionEvent('evt_after_cancel', OTHER.subscription, OTHER.customer),
      stub(calls, 'business', OTHER.customer, OTHER.subscription, await workspaceStamp())
    )
    expect(result.body).toMatchObject({ handled: false, foreign: true })
    expect(await storedCloud()).toMatchObject({
      plan: 'free',
      billing: { customerRef: MINE.customer },
    })
    expect(calls.pushes).toEqual([])
  })

  it('still refuses a foreign event after a reconcile tick', async () => {
    // Re-entry 2: the sweep added to make a missed webhook recoverable was
    // itself calling the null-apply on every unsubscribed workspace, erasing
    // the identity the ownership check depends on — every fifteen minutes,
    // for the entire free population.
    const { reconcileBilling } = await import('../billing.service')
    await testDb.delete(billingSubscriptionState)

    const reconciled = await reconcileBilling({
      client: stub(
        { fetched: [], pushes: [], customerLookups: [] },
        'pro',
        MINE.customer,
        MINE.subscription
      ),
    })
    // A known customer with no recorded subscription is ambiguous: they may
    // have cancelled, or a subscription may exist that this workspace has lost
    // track of. Asserting Free from a timer resolves that by downgrading
    // someone who may well be paying, which no human asked for — so the sweep
    // leaves the plan alone and says so. Pinning the PLAN is what makes this
    // assertion see the skip; pinning only the customer would pass either way,
    // because keeping the customer is already guaranteed upstream.
    expect(reconciled).toEqual({ reconciled: true, plan: 'pro' })
    expect(await storedCloud()).toMatchObject({
      plan: 'pro',
      billing: { customerRef: MINE.customer },
    })

    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
    const result = await deliver(
      subscriptionEvent('evt_after_sweep', OTHER.subscription, OTHER.customer),
      stub(calls, 'business', OTHER.customer, OTHER.subscription, await workspaceStamp())
    )
    expect(result.body).toMatchObject({ handled: false, foreign: true })
    expect(await storedCloud()).toMatchObject({ billing: { customerRef: MINE.customer } })
  })

  it('records a foreign event as consumed, so it is not re-fetched forever', async () => {
    const calls: Calls = { fetched: [], pushes: [], customerLookups: [] }
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
