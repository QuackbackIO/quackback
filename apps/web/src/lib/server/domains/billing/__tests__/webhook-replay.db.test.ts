/**
 * Webhook idempotency and replay safety.
 *
 * Three failure modes a provider inflicts on every integration, kept apart
 * deliberately because they need different mechanisms:
 *
 *   redelivery      -> the event ledger, keyed by the provider's event id
 *   out-of-order    -> re-fetch authoritative state + a snapshot timestamp
 *   transient error -> the claim is released so the retry is allowed to work
 *
 * The third is the one that turns an idempotency guard into a data-loss bug
 * if it is forgotten: a handler that fails after claiming, and never releases,
 * has permanently consumed an event the provider will keep resending and the
 * system will keep ignoring.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { billingWebhookEvents, settings } from '@/lib/server/db'

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
    getWorkspaceSettings: async () => {
      const db = (await import('@/lib/server/__tests__/db-test-fixture')).testDb
      const row = await db.query.settings.findFirst()
      return row ? { settings: row } : null
    },
  }
})

const { handleBillingWebhook, CLAIM_LEASE_MS } = await import('../webhook.service')
const { signWebhookPayload } = await import('../provider/signature')
const { BILLING_PROVIDER, resetBillingConfigCache } = await import('../billing.config')
import type { BillingProviderClient } from '../provider/client'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: billingWebhookEvents.providerEventId })
      .from(billingWebhookEvents)
      .limit(0)
    await db.select({ revision: settings.cloudRevision }).from(settings).limit(0)
  },
})

const SECRET = 'whsec_replay'
const CATALOGUE = {
  free: { seat: 'price_free' },
  pro: { seat: 'price_pro_seat', limits: { maxBoards: 25 } },
  scale: { seat: 'price_scale_seat', limits: { maxBoards: 100 } },
}

type Client = BillingProviderClient

/**
 * A provider stub whose customer carries this workspace's stamp.
 *
 * Needed because the workspace in this suite has no customer on record, so
 * every delivery takes the adoption path — and adoption is verified against
 * the provider rather than assumed. An unstamped customer here would be
 * refused as foreign, which is correct behaviour and the wrong thing for this
 * suite to be testing.
 */
function stub(plan: 'pro' | 'scale', onFetch?: () => void): Client {
  return {
    getCustomer: vi.fn(async (id: string) => ({
      id,
      email: null,
      metadata: { quackback_workspace: stampedWorkspaceId },
    })),
    getSubscription: vi.fn(async (id: string) => {
      onFetch?.()
      return {
        id,
        customer: 'cus_replay',
        status: 'active',
        current_period_end: 1_774_915_200,
        items: {
          data: [
            {
              id: 'si_seat',
              quantity: 1,
              price: { id: plan === 'pro' ? 'price_pro_seat' : 'price_scale_seat' },
            },
          ],
        },
      }
    }),
    updateSubscriptionItems: vi.fn(async (id: string) => ({
      id,
      customer: 'cus_replay',
      status: 'active',
      items: { data: [] },
    })),
    reportMeterEvent: vi.fn(),
    createCustomer: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    listInvoices: vi.fn(async () => []),
    listPaymentMethods: vi.fn(async () => []),
  } as unknown as Client
}

function deliver(body: Record<string, unknown>, client: Client, now = new Date()) {
  const raw = JSON.stringify(body)
  return handleBillingWebhook(
    raw,
    signWebhookPayload(raw, SECRET, Math.floor(now.getTime() / 1000)),
    { client, now }
  )
}

function event(id: string, type: string, subscriptionRef = 'sub_replay') {
  return {
    id,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: subscriptionRef, customer: 'cus_replay' } },
  }
}

async function storedPlan(): Promise<string | null> {
  const row = await testDb.query.settings.findFirst()
  return (row?.cloud as { plan?: string } | null)?.plan ?? null
}

let stampedWorkspaceId = ''

beforeEach(async () => {
  await fixture.begin()
  await testDb.delete(billingWebhookEvents)
  await testDb.insert(settings).values({
    name: 'Replay',
    slug: `replay-${createId('workspace')}`,
    createdAt: new Date(),
  })
  process.env.BILLING_API_KEY = 'sk_test_replay'
  process.env.BILLING_WEBHOOK_SECRET = SECRET
  process.env.BILLING_PRICES = JSON.stringify(CATALOGUE)
  resetBillingConfigCache()
  const { workspaceStamp } = await import('../identity')
  stampedWorkspaceId = await workspaceStamp()
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

describe.skipIf(!fixture.available)('webhook idempotency and replay', () => {
  it('handles a delivery once and ignores every redelivery of it', async () => {
    const fetches: number[] = []
    const client = stub('pro', () => fetches.push(1))

    const first = await deliver(event('evt_1', 'customer.subscription.updated'), client)
    expect(first).toEqual({ status: 200, body: { received: true, handled: true } })

    for (let i = 0; i < 3; i++) {
      const repeat = await deliver(event('evt_1', 'customer.subscription.updated'), client)
      expect(repeat).toEqual({
        status: 200,
        body: { received: true, handled: false, duplicate: true },
      })
    }

    // One handler run, one provider fetch, one ledger row.
    expect(fetches).toHaveLength(1)
    const rows = await testDb.select().from(billingWebhookEvents)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.processedAt).not.toBeNull()
    expect(rows[0]!.lastError).toBeNull()
  })

  it('acknowledges an event type it does not act on, without handling it', async () => {
    const client = stub('pro')
    const result = await deliver(event('evt_ignored', 'customer.discount.created'), client)
    expect(result).toEqual({ status: 200, body: { received: true, handled: false } })
    expect(client.getSubscription).not.toHaveBeenCalled()
    // Still recorded, so a redelivery of it is cheap too.
    const rows = await testDb.select().from(billingWebhookEvents)
    expect(rows.map((r) => r.providerEventId)).toEqual(['evt_ignored'])
  })

  it('converges on the same state when two events arrive out of order', async () => {
    // The provider says "you moved to Scale" and then "you moved to Pro",
    // and the network delivers them backwards. Because the handler re-fetches
    // authoritative state instead of trusting the payload, both deliveries
    // apply whatever the subscription actually is now.
    await deliver(event('evt_later', 'customer.subscription.updated'), stub('scale'))
    expect(await storedPlan()).toBe('scale')

    // The earlier event arrives late. Its payload is irrelevant; the fetch
    // still reports Scale, so nothing regresses.
    await deliver(event('evt_earlier', 'customer.subscription.updated'), stub('scale'))
    expect(await storedPlan()).toBe('scale')
  })

  it('refuses to apply a snapshot older than the one already applied', async () => {
    // The residual race the re-fetch cannot solve: two handlers read at
    // different times and commit in the wrong order. The snapshot timestamp
    // is what makes the older one a no-op.
    const { applySubscription, toSnapshot } = await import('../subscription')
    const { getBillingConfig } = await import('../billing.config')
    const config = getBillingConfig()!

    const newer = toSnapshot(
      {
        id: 'sub_replay',
        customer: 'cus_replay',
        status: 'active',
        current_period_end: 1_774_915_200,
        items: { data: [{ id: 'si', quantity: 1, price: { id: 'price_scale_seat' } }] },
      },
      config,
      new Date('2026-05-02T00:00:00.000Z')
    )
    const older = toSnapshot(
      {
        id: 'sub_replay',
        customer: 'cus_replay',
        status: 'active',
        current_period_end: 1_774_915_200,
        items: { data: [{ id: 'si', quantity: 1, price: { id: 'price_pro_seat' } }] },
      },
      config,
      new Date('2026-05-01T00:00:00.000Z')
    )

    await applySubscription(newer, config)
    expect(await storedPlan()).toBe('scale')

    const result = await applySubscription(older, config)
    expect(result.stale).toBe(true)
    // Without the guard this would read 'pro'.
    expect(await storedPlan()).toBe('scale')
  })

  it('releases the claim when the handler fails, so the retry can succeed', async () => {
    const failing = stub('pro', () => {
      throw new Error('provider unavailable')
    })
    const first = await deliver(event('evt_retry', 'customer.subscription.updated'), failing)
    // A 5xx is what asks the provider to try again.
    expect(first).toEqual({ status: 500, body: { error: 'handler_failed' } })
    expect(await storedPlan()).toBeNull()
    // The claim is gone, so the redelivery is not mistaken for a duplicate.
    expect(await testDb.select().from(billingWebhookEvents)).toHaveLength(0)

    const retry = await deliver(event('evt_retry', 'customer.subscription.updated'), stub('pro'))
    expect(retry).toEqual({ status: 200, body: { received: true, handled: true } })
    expect(await storedPlan()).toBe('pro')
  })

  it('rejects an unsigned delivery without touching the ledger', async () => {
    const client = stub('pro')
    const raw = JSON.stringify(event('evt_unsigned', 'customer.subscription.updated'))
    const result = await handleBillingWebhook(raw, null, { client })
    expect(result).toEqual({ status: 400, body: { error: 'signature_missing_header' } })
    expect(await testDb.select().from(billingWebhookEvents)).toHaveLength(0)
    expect(client.getSubscription).not.toHaveBeenCalled()
  })

  it('rejects a forged delivery even when the body is a valid event', async () => {
    const client = stub('scale')
    const raw = JSON.stringify(event('evt_forged', 'customer.subscription.updated'))
    const forged = signWebhookPayload(raw, 'whsec_attacker', Math.floor(Date.now() / 1000))
    const result = await handleBillingWebhook(raw, forged, { client })
    expect(result).toEqual({ status: 400, body: { error: 'signature_no_matching_signature' } })
    expect(await storedPlan()).toBeNull()
  })

  it('refuses everything when no billing provider is configured', async () => {
    delete process.env.BILLING_API_KEY
    delete process.env.BILLING_WEBHOOK_SECRET
    delete process.env.BILLING_PRICES
    resetBillingConfigCache()

    const raw = JSON.stringify(event('evt_off', 'customer.subscription.updated'))
    // Correctly signed for the secret that WOULD be configured — the refusal
    // has to come from the feature being off, not from the signature.
    const signature = signWebhookPayload(raw, SECRET, Math.floor(Date.now() / 1000))
    const result = await handleBillingWebhook(raw, signature, { client: stub('pro') })
    expect(result).toEqual({ status: 400, body: { error: 'billing_not_configured' } })
    expect(await testDb.select().from(billingWebhookEvents)).toHaveLength(0)
    expect(await storedPlan()).toBeNull()
  })

  it('retries a claim whose handler crashed before it could release it', async () => {
    // The normal error path releases the claim. This is the abnormal one: a
    // pod kill, an OOM, or a failing releaseClaim leaves the row behind with
    // processed_at NULL. Before the lease existed, every subsequent
    // redelivery was answered "duplicate" while nothing had ever been
    // applied — the event was stranded permanently and silently, and the
    // module's own docstring claimed otherwise.
    const crashedAt = new Date(Date.now() - CLAIM_LEASE_MS - 60_000)
    await testDb.insert(billingWebhookEvents).values({
      providerEventId: 'evt_crashed',
      provider: BILLING_PROVIDER,
      eventType: 'customer.subscription.updated',
      receivedAt: crashedAt,
      processedAt: null,
    })

    const result = await deliver(event('evt_crashed', 'customer.subscription.updated'), stub('pro'))
    expect(result).toEqual({ status: 200, body: { received: true, handled: true } })
    expect(await storedPlan()).toBe('pro')

    // The row was reclaimed rather than duplicated, and is now settled.
    const rows = await testDb.select().from(billingWebhookEvents)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.processedAt).not.toBeNull()
  })

  it('treats a claim that is still in flight as a duplicate', async () => {
    // The other side of the lease. A redelivery arriving while the first
    // attempt is genuinely running must NOT start a second handler: two
    // concurrent runs would push seat quantities twice and race the snapshot
    // guard for no benefit.
    await testDb.insert(billingWebhookEvents).values({
      providerEventId: 'evt_inflight',
      provider: BILLING_PROVIDER,
      eventType: 'customer.subscription.updated',
      receivedAt: new Date(),
      processedAt: null,
    })

    const result = await deliver(
      event('evt_inflight', 'customer.subscription.updated'),
      stub('scale')
    )
    expect(result).toEqual({
      status: 200,
      body: { received: true, handled: false, duplicate: true },
    })
    expect(await storedPlan()).toBeNull()
  })

  it('treats a completed claim as a duplicate however old it is', async () => {
    // Age alone must not reopen a settled event, or every redelivery after
    // the lease window would re-run the handler forever.
    await testDb.insert(billingWebhookEvents).values({
      providerEventId: 'evt_done',
      provider: BILLING_PROVIDER,
      eventType: 'customer.subscription.updated',
      receivedAt: new Date(Date.now() - CLAIM_LEASE_MS * 100),
      processedAt: new Date(Date.now() - CLAIM_LEASE_MS * 100),
    })

    const result = await deliver(event('evt_done', 'customer.subscription.updated'), stub('scale'))
    expect(result).toEqual({
      status: 200,
      body: { received: true, handled: false, duplicate: true },
    })
    expect(await storedPlan()).toBeNull()
  })

  it('rejects a body that is not JSON', async () => {
    const raw = 'not json at all'
    const signature = signWebhookPayload(raw, SECRET, Math.floor(Date.now() / 1000))
    const result = await handleBillingWebhook(raw, signature, { client: stub('pro') })
    expect(result).toEqual({ status: 400, body: { error: 'invalid_json' } })
  })
})
