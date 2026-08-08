/**
 * A self-serve upgrade, end to end, against a real database.
 *
 * The path proven here is the whole point of moving billing into the product:
 *
 *   unconfigured install      -> nothing is gated at all
 *   billing on, no purchase   -> Free, and a Pro feature is refused BY NAME
 *   signed webhook arrives    -> plan, entitlements and numeric limits move
 *   the same call             -> now succeeds
 *
 * Every step is executed, none is asserted about. The refusal at step two and
 * the success at step four are the *same function call* on the same
 * workspace, so nothing about the assertion can be satisfied by a test double
 * agreeing with itself.
 *
 * The provider is a stub, because the provider is not what is being tested —
 * but the stub is exercised through the real webhook entry point, including
 * real HMAC verification over the real raw body.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, principalRoleAssignments, settings, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Redis-backed cache invalidation. Not what this file is about; the settings
// read below is redirected at the database so the real resolve/gate path runs.
vi.mock('@/lib/server/domains/settings/settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/domains/settings/settings.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/settings/settings.service')>()
  return {
    ...actual,
    // The real getTenantSettings assembles a large blob through Redis. Only
    // the raw row matters to the entitlement path, so this reads it straight
    // from the test transaction — the resolve, precedence and refusal logic
    // downstream is entirely unmocked.
    getTenantSettings: async () => {
      const db = (await import('@/lib/server/__tests__/db-test-fixture')).testDb
      const row = await db.query.settings.findFirst()
      return row ? { settings: row } : null
    },
  }
})

const { writeCloudConfig } = await import(
  '@/lib/server/domains/settings/cloud/cloud.service'
)
const { requireEntitlement, hasEntitlement } = await import(
  '@/lib/server/domains/settings/cloud/entitlements'
)
const { getTierLimits, invalidateTierLimitsCache } = await import(
  '@/lib/server/domains/settings/tier-limits.service'
)
const { EntitlementRequiredError } = await import('@/lib/server/errors/entitlement-error')
const { handleBillingWebhook } = await import('../webhook.service')
const { signWebhookPayload } = await import('../provider/signature')
const { resetBillingConfigCache } = await import('../billing.config')
const { applySubscription, currentSubscriptionRef } = await import('../subscription')
const { getBillingConfig } = await import('../billing.config')
import type { BillingProviderClient } from '../provider/client'
const { countSeats } = await import('../seats')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ cloud: settings.cloud, revision: settings.cloudRevision }).from(settings).limit(0)
  },
})

const WEBHOOK_SECRET = 'whsec_upgrade_e2e'
const CATALOGUE = {
  free: { seat: 'price_free_seat', limits: { maxBoards: 2 } },
  pro: {
    seat: 'price_pro_seat',
    liteSeat: 'price_pro_lite',
    copilotSeat: 'price_pro_copilot',
    outcome: 'price_pro_outcome',
    outcomeMeter: 'quackback_outcome',
    limits: { maxBoards: 25, aiTokensPerMonth: 1_000_000 },
  },
}

/** What the provider reports before anything is pushed. */
const INITIAL_QUANTITIES = { si_seat: 1, si_lite: 0, si_copilot: 0 }

/** Calls the stub recorded, so seat pushes can be asserted. */
interface StubCalls {
  updates: Array<{
    id: string
    items: Array<{ id?: string; quantity?: number }>
    idempotencyKey: string
  }>
  meterEvents: Array<{ identifier: string; value: number }>
}

/**
 * A stateful provider stub.
 *
 * Stateful on purpose: a stub that always replays the same quantities would
 * make "the second sync pushes nothing" pass whether or not the comparison
 * worked, because the desired count would always differ from the reported
 * one. Applying the update means the no-op assertion has something real to
 * be true about.
 */
function makeStub(calls: StubCalls, status = 'active', quantities = { ...INITIAL_QUANTITIES }) {
  return {
    getSubscription: vi.fn(async (id: string) => ({
      id,
      customer: 'cus_e2e',
      status,
      current_period_end: 1_774_915_200,
      items: {
        data: [
          { id: 'si_seat', quantity: quantities.si_seat, price: { id: 'price_pro_seat' } },
          { id: 'si_lite', quantity: quantities.si_lite, price: { id: 'price_pro_lite' } },
          { id: 'si_copilot', quantity: quantities.si_copilot, price: { id: 'price_pro_copilot' } },
          { id: 'si_outcome', price: { id: 'price_pro_outcome' } },
        ],
      },
    })),
    updateSubscriptionItems: vi.fn(async (id, items, idempotencyKey) => {
      calls.updates.push({ id, items, idempotencyKey })
      for (const item of items) {
        if (item.id && item.quantity !== undefined) {
          ;(quantities as Record<string, number>)[item.id] = item.quantity
        }
      }
      return { id, customer: 'cus_e2e', status, items: { data: [] } }
    }),
    reportMeterEvent: vi.fn(async (input: { identifier: string; value: number }) => {
      calls.meterEvents.push({ identifier: input.identifier, value: input.value })
    }),
    createCustomer: vi.fn(),
    getCustomer: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    listInvoices: vi.fn(async () => []),
    listPaymentMethods: vi.fn(async () => []),
  } as unknown as BillingProviderClient
}

function deliver(
  body: Record<string, unknown>,
  client: BillingProviderClient,
  now = new Date()
) {
  const raw = JSON.stringify(body)
  const signature = signWebhookPayload(raw, WEBHOOK_SECRET, Math.floor(now.getTime() / 1000))
  return handleBillingWebhook(raw, signature, { client, now })
}

beforeEach(async () => {
  await fixture.begin()
  await testDb.insert(settings).values({
    name: 'Upgrade E2E',
    slug: `upgrade-e2e-${Date.now()}`,
    createdAt: new Date(),
  })
  process.env.BILLING_API_KEY = 'sk_test_e2e'
  process.env.BILLING_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.BILLING_PRICES = JSON.stringify(CATALOGUE)
  resetBillingConfigCache()
  invalidateTierLimitsCache()
})

afterEach(async () => {
  await fixture.rollback()
  delete process.env.BILLING_API_KEY
  delete process.env.BILLING_WEBHOOK_SECRET
  delete process.env.BILLING_PRICES
  resetBillingConfigCache()
  invalidateTierLimitsCache()
  vi.clearAllMocks()
})

afterAll(async () => {
  await fixture.close()
})

describe.skipIf(!fixture.available)('self-serve upgrade, end to end', () => {
  it('takes a workspace from ungated, through a named refusal, to the feature working', async () => {
    // --- 1. Unconfigured: nothing is gated. This is the state every
    // self-hosted install is in, and the state this workspace starts in
    // because `settings.cloud` is NULL.
    await expect(requireEntitlement('customDomain')).resolves.toBeUndefined()
    expect(await getTierLimits()).toMatchObject({ maxBoards: null })

    // --- 2. Billing on, nothing purchased: Free, and the Pro feature is
    // refused with a message that names the plan to buy.
    const config = getBillingConfig()!
    await applySubscription(null, config)
    invalidateTierLimitsCache()

    const refusal = await requireEntitlement('customDomain').catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(EntitlementRequiredError)
    const payload = (refusal as InstanceType<typeof EntitlementRequiredError>).toResponseBody()
    expect(payload).toMatchObject({
      error: 'entitlement_required',
      entitlement: 'customDomain',
      currentPlan: 'free',
      requiredPlan: 'pro',
      message: 'Custom domains are a Pro feature. Your workspace is on Free. Upgrade to Pro to enable it.',
    })
    // The Free plan's numeric limits landed too, from the same catalogue.
    expect(await getTierLimits()).toMatchObject({ maxBoards: 2, aiTokensPerMonth: null })

    // --- 3. The customer completes checkout and the provider tells us.
    const calls: StubCalls = { updates: [], meterEvents: [] }
    const outcome = await deliver(
      {
        id: 'evt_upgrade_1',
        type: 'customer.subscription.created',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls)
    )
    expect(outcome).toEqual({ status: 200, body: { received: true, handled: true } })
    invalidateTierLimitsCache()

    // --- 4. The same call that was refused now returns.
    await expect(requireEntitlement('customDomain')).resolves.toBeUndefined()
    expect(await hasEntitlement('workflows')).toBe(true)
    // Still not everything: Pro does not grant SSO, so the gate is doing real
    // work rather than having been switched off.
    expect(await hasEntitlement('sso')).toBe(false)

    // Plan, billing references and numeric limits all moved together.
    const row = await testDb.query.settings.findFirst()
    expect(row?.cloud).toMatchObject({
      enabled: true,
      plan: 'pro',
      source: 'billing',
      billing: {
        provider: 'stripe',
        customerRef: 'cus_e2e',
        subscriptionRef: 'sub_e2e',
        status: 'active',
        currentPeriodEnd: new Date(1_774_915_200 * 1000).toISOString(),
      },
    })
    expect(await getTierLimits()).toMatchObject({ maxBoards: 25, aiTokensPerMonth: 1_000_000 })
    expect(await currentSubscriptionRef()).toMatchObject({
      subscriptionRef: 'sub_e2e',
      customerRef: 'cus_e2e',
    })
  })

  it('pushes the seat count derived from the product, not the one in the subscription', async () => {
    // Two teammates exist; the subscription the provider returns says one
    // seat. The push must carry the product's number, not the provider's.
    await testDb.delete(principalRoleAssignments)
    await testDb.delete(principal)
    for (const role of ['admin', 'member'] as const) {
      const userId = createId('user')
      await testDb.insert(user).values({ id: userId, name: role, email: `${userId}@example.test` })
      await testDb.insert(principal).values({
        id: createId('principal'),
        userId,
        role,
        type: 'user',
        createdAt: new Date(),
      })
    }
    const seats = await countSeats()
    expect(seats).toEqual({ full: 2, lite: 0, copilot: 2, total: 2 })

    const calls: StubCalls = { updates: [], meterEvents: [] }
    // One shared quantity bag across every stub in this test, so the pushes
    // actually land somewhere the next read can see.
    const settled = { ...INITIAL_QUANTITIES }
    await deliver(
      {
        id: 'evt_seat_1',
        type: 'customer.subscription.created',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls, 'active', settled)
    )

    expect(calls.updates).toHaveLength(1)
    expect(calls.updates[0]!.id).toBe('sub_e2e')
    // Every sold meter is pushed on the FIRST sync, including si_lite whose
    // quantity happens to already match — there is no local record yet to
    // compare against, and trusting the provider's copy alone would leave a
    // dashboard-side edit permanently unreconciled. Subsequent syncs skip
    // unchanged items (asserted below).
    expect(calls.updates[0]!.items).toEqual([
      { id: 'si_seat', quantity: 2 },
      { id: 'si_lite', quantity: 0 },
      { id: 'si_copilot', quantity: 2 },
    ])
    // Keyed on the intent, so a retry of the same seat count collapses.
    expect(calls.updates[0]!.idempotencyKey).toBe(
      'seats:sub_e2e:fullSeat=2,liteSeat=0,copilotSeat=2'
    )

    // A redelivery of the same event changes nothing, and a genuinely fresh
    // event with an unchanged seat count makes no provider call at all.
    const replay = await deliver(
      {
        id: 'evt_seat_1',
        type: 'customer.subscription.created',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls, 'active', settled)
    )
    expect(replay).toEqual({ status: 200, body: { received: true, handled: false, duplicate: true } })
    expect(calls.updates).toHaveLength(1)

    await deliver(
      {
        id: 'evt_seat_2',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls, 'active', settled)
    )
    // Handled, but nothing to say: quantities now match on both sides.
    expect(calls.updates).toHaveLength(1)
  })

  it('downgrades to Free and re-refuses when the subscription is deleted', async () => {
    const calls: StubCalls = { updates: [], meterEvents: [] }
    await deliver(
      {
        id: 'evt_up',
        type: 'customer.subscription.created',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls)
    )
    await expect(requireEntitlement('customDomain')).resolves.toBeUndefined()

    await deliver(
      {
        id: 'evt_down',
        type: 'customer.subscription.deleted',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls)
    )
    invalidateTierLimitsCache()

    await expect(requireEntitlement('customDomain')).rejects.toBeInstanceOf(
      EntitlementRequiredError
    )
    const row = await testDb.query.settings.findFirst()
    expect(row?.cloud).toMatchObject({ enabled: true, plan: 'free' })
    // The subscription reference is cleared, not left dangling.
    expect((row?.cloud as { billing?: { subscriptionRef?: string | null } })?.billing?.subscriptionRef).toBeNull()
    expect(await currentSubscriptionRef()).toBeNull()
    expect(await getTierLimits()).toMatchObject({ maxBoards: 2 })
  })

  it('keeps the plan while payment is overdue', async () => {
    const calls: StubCalls = { updates: [], meterEvents: [] }
    await deliver(
      {
        id: 'evt_pastdue',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls, 'past_due')
    )
    // A failed renewal must not cut a paying customer off mid-dunning.
    await expect(requireEntitlement('customDomain')).resolves.toBeUndefined()
    const row = await testDb.query.settings.findFirst()
    expect(row?.cloud).toMatchObject({ plan: 'pro', billing: { status: 'past_due' } })
  })

  it('refuses to write a plan the config file has pinned', async () => {
    // An operator pinning cloud.plan in /etc/quackback/config.yaml must beat
    // a webhook. Without this the file's declaration would last until the
    // next provider event and then silently vanish.
    await testDb.update(settings).set({ managedFieldPaths: ['cloud.enabled', 'cloud.plan'] })
    await expect(
      writeCloudConfig({ plan: 'pro' }, { writer: 'billing' })
    ).rejects.toThrow(/managed by the declarative config file/i)
  })
})
