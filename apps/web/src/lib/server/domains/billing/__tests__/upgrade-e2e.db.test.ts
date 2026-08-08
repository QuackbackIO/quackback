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
import { PERMISSIONS } from '@/lib/shared/permissions'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  billingSubscriptionState,
  eq,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  settings,
  user,
} from '@/lib/server/db'

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
const { BILLING_PROVIDER, resetBillingConfigCache } = await import('../billing.config')
const { applySubscription, currentSubscriptionRef } = await import('../subscription')
const { getBillingConfig } = await import('../billing.config')
import type { BillingProviderClient } from '../provider/client'
const { countSeats } = await import('../seats')
const { billableQuantities, checkoutLineItems } = await import('../seat-sync')

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
    // Stamped for this workspace: the suite's workspace has no customer on
    // record, so every delivery takes the adoption path, which verifies the
    // stamp against the provider rather than assuming ownership.
    getCustomer: vi.fn(async (id: string) => ({
      id,
      email: null,
      metadata: { quackback_workspace: stampedWorkspaceId },
    })),
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

let stampedWorkspaceId = ''

beforeEach(async () => {
  await fixture.begin()
  await testDb.insert(settings).values({
    name: 'Upgrade E2E',
    slug: `upgrade-e2e-${createId('workspace')}`,
    createdAt: new Date(),
  })
  process.env.BILLING_API_KEY = 'sk_test_e2e'
  process.env.BILLING_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.BILLING_PRICES = JSON.stringify(CATALOGUE)
  resetBillingConfigCache()
  invalidateTierLimitsCache()
  const { workspaceStamp } = await import('../identity')
  stampedWorkspaceId = await workspaceStamp()
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

/**
 * Create `count` teammates whose only support-surface permission is a read, so
 * they classify as lite seats.
 */
async function addLiteTeammates(count: number): Promise<void> {
  const roleId = createId('role')
  await testDb.insert(roles).values({
    id: roleId,
    key: `lite-${roleId}`,
    name: `Lite-${roleId}`,
    isSystem: false,
    createdAt: new Date(),
  })
  for (const key of [PERMISSIONS.POST_CREATE, PERMISSIONS.CONVERSATION_VIEW]) {
    const [permission] = await testDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, key))
      .limit(1)
    await testDb
      .insert(rolePermissions)
      .values({ id: createId('role_permission'), roleId, permissionId: permission!.id })
  }
  for (let i = 0; i < count; i++) {
    const userId = createId('user')
    await testDb.insert(user).values({ id: userId, name: `pm${i}`, email: `${userId}@example.test` })
    const principalId = createId('principal')
    await testDb.insert(principal).values({
      id: principalId,
      userId,
      role: 'member',
      type: 'user',
      createdAt: new Date(),
    })
    await testDb
      .insert(principalRoleAssignments)
      .values({ id: createId('role_assignment'), principalId, roleId, teamId: null })
  }
}

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
        provider: BILLING_PROVIDER,
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
    // The subscription the provider returns reports 1 seat. The push must
    // carry the PRODUCT's count instead — that is the whole reason billing
    // moved into the product.
    //
    // Deliberately no `DELETE FROM principal` here: `quackback_test` is shared
    // across checkouts, so clearing it takes a row lock on every principal and
    // makes this file contend with every other suite. The expectation is
    // derived from the live count instead, and the two teammates added below
    // prove the count is really being read rather than echoed.
    const before = await countSeats()
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
    expect(seats.full).toBe(before.full + 2)

    const settled = { ...INITIAL_QUANTITIES }
    const calls: StubCalls = { updates: [], meterEvents: [] }
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
    // Every sold meter is pushed on the FIRST sync — there is no local record
    // yet to compare against, and trusting the provider's copy alone would
    // leave a dashboard-side edit permanently unreconciled.
    expect(calls.updates[0]!.items).toEqual([
      { id: 'si_seat', quantity: seats.full },
      { id: 'si_lite', quantity: seats.lite },
      // Copilot bills per paid user, so its quantity is the full-seat count.
      { id: 'si_copilot', quantity: seats.full },
    ])
    // And it is NOT the number the provider reported.
    expect(seats.full).not.toBe(INITIAL_QUANTITIES.si_seat)
    expect(calls.updates[0]!.idempotencyKey).toBe(
      `seats:sub_e2e:fullSeat=${seats.full},liteSeat=${seats.lite},copilotSeat=${seats.full}`
    )

    // A redelivery changes nothing, and a fresh event with an unchanged seat
    // count makes no provider call at all.
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

  it('recovers a missed delivery through the reconcile path', async () => {
    // The webhook is the fast path, not the only one. A delivery that never
    // arrives — or whose handler dies past its claim lease — would otherwise
    // leave the workspace on the wrong plan until a human pressed Refresh,
    // with nothing surfacing that it happened. `reconcileBilling()` is the
    // recovery, and it runs on a timer in `startup.ts`.
    const calls: StubCalls = { updates: [], meterEvents: [] }
    await deliver(
      {
        id: 'evt_initial',
        type: 'customer.subscription.created',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls)
    )
    invalidateTierLimitsCache()
    expect(await getTierLimits()).toMatchObject({ maxBoards: 25 })

    // The customer cancels at the provider. No webhook reaches us.
    const cancelled = makeStub(calls, 'canceled')
    const { reconcileBilling } = await import('../billing.service')
    const result = await reconcileBilling({ client: cancelled })
    invalidateTierLimitsCache()

    expect(result).toEqual({ reconciled: true, plan: 'free' })
    await expect(requireEntitlement('customDomain')).rejects.toBeInstanceOf(
      EntitlementRequiredError
    )
    expect(await getTierLimits()).toMatchObject({ maxBoards: 2 })
  })

  it('reconciles to Free when the workspace never subscribed', async () => {
    // The other half: a billing-enabled deployment must gate an unsubscribed
    // workspace as Free rather than leaving it ungated.
    const { reconcileBilling } = await import('../billing.service')
    const calls: StubCalls = { updates: [], meterEvents: [] }
    expect(await reconcileBilling({ client: makeStub(calls) })).toEqual({
      reconciled: true,
      plan: 'free',
    })
    const row = await testDb.query.settings.findFirst()
    expect(row?.cloud).toMatchObject({ enabled: true, plan: 'free' })
  })

  it('does not re-push an unchanged seat count when another subscription row is newer', async () => {
    // The deterministic form of a flake that would not reproduce: an unchanged
    // seat count re-pushed on a later delivery. The cause was reading the
    // synced quantities off "the most recently updated row" in
    // `billing_subscription_state` rather than off the subscription being
    // synced — so any newer row for a different subscription made the sync
    // believe nothing had been pushed.
    //
    // At the provider a redundant push is not free: it is a proration event on
    // a real invoice, which is exactly the class of bug that is invisible in
    // tests and expensive in production.
    const settled = { ...INITIAL_QUANTITIES }
    const calls: StubCalls = { updates: [], meterEvents: [] }
    await deliver(
      {
        id: 'evt_a',
        type: 'customer.subscription.created',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls, 'active', settled)
    )
    expect(calls.updates).toHaveLength(1)

    // A second, unrelated subscription row lands with a newer updated_at —
    // a stale record from an earlier subscription, or a second one in flight.
    await testDb.insert(billingSubscriptionState).values({
      subscriptionRef: 'sub_unrelated',
      provider: BILLING_PROVIDER,
      customerRef: 'cus_e2e',
      snapshotFetchedAt: new Date(),
      syncedQuantities: {},
      updatedAt: new Date(Date.now() + 60_000),
    })

    await deliver(
      {
        id: 'evt_b',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls, 'active', settled)
    )
    // Still one. The seat count did not change, so nothing should be sent.
    expect(calls.updates).toHaveLength(1)
  })

  it('bills an all-lite workspace consistently from checkout through the first sync', async () => {
    // The boundary two separate quantity expressions got wrong, end to end.
    //
    // Narrowing "lite" to the customer-support surface makes an all-lite
    // workspace ordinary: a feedback-only install whose custom role grants
    // board writes and support reads. Checkout used to floor the seat line to
    // one and the first webhook pushed it back to zero — either rejecting the
    // update and 500ing forever, or charging and crediting a phantom seat.
    const before = await countSeats()
    await addLiteTeammates(3)
    const seats = await countSeats()
    // Scoped: the three just added are lite, whatever else the shared test
    // database happens to contain.
    expect(seats.lite).toBe(before.lite + 3)
    expect(seats.full).toBe(before.full)

    // Checkout and the sync must derive the same numbers.
    const config = getBillingConfig()!
    const lines = checkoutLineItems(config, 'pro', seats, { copilot: true })
    const seatLine = lines.find((line) => line.price === 'price_pro_seat')
    const copilotLine = lines.find((line) => line.price === 'price_pro_copilot')

    // With no support-side writer anywhere, both are absent rather than floored.
    if (seats.full === 0) {
      expect(seatLine).toBeUndefined()
      expect(copilotLine).toBeUndefined()
    }
    // And whatever the shape, checkout equals what the sync would push.
    const desired = billableQuantities(seats, config.catalogue.pro)
    expect(seatLine?.quantity ?? 0).toBe(desired.fullSeat)
    expect(copilotLine?.quantity ?? 0).toBe(desired.copilotSeat)
  })

  it('creates a seat item on sync when the class had none at checkout', async () => {
    // The leak removing the floor could have introduced: an all-lite workspace
    // buys no full-seat item, then hires a support agent. The sync used to
    // skip any meter with no existing item, so that agent would never be
    // billed. Creating the item is bounded to seat meters the plan sells —
    // never the opt-in add-on.
    const settled = { si_seat: 0, si_lite: 0, si_copilot: 0 }
    const calls: StubCalls = { updates: [], meterEvents: [] }
    const stub = makeStub(calls, 'active', settled)
    // A subscription that carries only the lite item, as an all-lite checkout
    // would have produced.
    stub.getSubscription = vi.fn(async (id: string) => ({
      id,
      customer: 'cus_e2e',
      status: 'active',
      current_period_end: 1_774_915_200,
      items: { data: [{ id: 'si_lite', quantity: 3, price: { id: 'price_pro_lite' } }] },
    }))

    await deliver(
      {
        id: 'evt_grow',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      stub
    )

    const seats = await countSeats()
    expect(calls.updates).toHaveLength(1)
    const pushed = calls.updates[0]!.items as Array<Record<string, unknown>>
    // The missing full-seat item is created by price, at the derived quantity.
    expect(pushed).toContainEqual({ price: 'price_pro_seat', quantity: seats.full })
    // The add-on is never created by a sync, however many paid seats exist.
    expect(pushed.some((item) => item.price === 'price_pro_copilot')).toBe(false)
  })

  it('does not duplicate a line when a price has been rotated', async () => {
    // The defect the creation path introduced, in its real shape.
    //
    // A price's amount is immutable at the provider, so ANY repricing mints a
    // new price object and retires the old one — while live subscriptions keep
    // billing under the retired id. That item resolves to no meter, and "no
    // meter" used to be indistinguishable from "no item", so the sync created
    // a replacement and the customer paid for the same seats twice, on the
    // same invoice, indefinitely.
    //
    // Deliberately a ROTATION and not a missing item: those two look identical
    // to the code being tested, which is the whole defect.
    //
    // Lite teammates are required, not decoration: with a derived lite count of
    // zero the creation branch is short-circuited by `want <= 0` and the test
    // passes whether or not the guard exists. It has to be a case where the
    // sync genuinely WOULD create.
    await addLiteTeammates(3)
    const seats = await countSeats()
    expect(seats.lite).toBeGreaterThan(0)

    const calls: StubCalls = { updates: [], meterEvents: [] }
    const stub = makeStub(calls, 'active', { ...INITIAL_QUANTITIES })
    stub.getSubscription = vi.fn(async (id: string) => ({
      id,
      customer: 'cus_e2e',
      status: 'active',
      current_period_end: 1_774_915_200,
      items: {
        data: [
          { id: 'si_seat', quantity: 1, price: { id: 'price_pro_seat' } },
          // Billing 3 lite seats under a price the catalogue has retired.
          { id: 'si_lite', quantity: 3, price: { id: 'price_pro_lite_retired' } },
        ],
      },
    }))

    await deliver(
      {
        id: 'evt_rotated',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      stub
    )

    const pushed = (calls.updates[0]?.items ?? []) as Array<Record<string, unknown>>
    // No new lite line. The old si_lite is still billing 3 lite seats under
    // the retired price; adding price_pro_lite at 3 would bill them twice on
    // the same invoice, indefinitely.
    expect(pushed.some((item) => item.price === 'price_pro_lite')).toBe(false)
    // Nothing at all was created — every push targets an existing item id.
    expect(pushed.every((item) => item.id !== undefined)).toBe(true)
  })

  it('still updates the items it CAN account for while one is unaccounted', async () => {
    // A stale line is a reason not to add, not a reason to freeze: the seats
    // that did resolve must still track the product's count, or a repricing
    // would silently stop all seat billing until someone noticed.
    const seatsBefore = await countSeats()
    const calls: StubCalls = { updates: [], meterEvents: [] }
    const stub = makeStub(calls, 'active', { ...INITIAL_QUANTITIES })
    stub.getSubscription = vi.fn(async (id: string) => ({
      id,
      customer: 'cus_e2e',
      status: 'active',
      current_period_end: 1_774_915_200,
      items: {
        data: [
          // Reports a quantity that does not match the derived count.
          { id: 'si_seat', quantity: 999, price: { id: 'price_pro_seat' } },
          { id: 'si_lite', quantity: 3, price: { id: 'price_pro_lite_retired' } },
        ],
      },
    }))

    await deliver(
      {
        id: 'evt_rotated_update',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      stub
    )

    const pushed = (calls.updates[0]?.items ?? []) as Array<Record<string, unknown>>
    expect(pushed).toContainEqual({ id: 'si_seat', quantity: seatsBefore.full })
  })

  it('pushes nothing to a subscription whose status does not entitle its plan', async () => {
    // The provider sends `customer.subscription.updated` with `canceled`
    // BEFORE `.deleted`, and refuses updates to a canceled subscription — so
    // pushing would throw, answer 500, and redeliver until the deletion lands.
    // No wrong bill, because the downgrade is already written; just retry
    // noise over a state the module already knows the answer to.
    const calls: StubCalls = { updates: [], meterEvents: [] }
    await deliver(
      {
        id: 'evt_canceled_update',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_e2e', customer: 'cus_e2e' } },
      },
      makeStub(calls, 'canceled')
    )
    expect(calls.updates).toEqual([])
    // The plan still moved — the guard is on the outbound push, not on
    // applying what the provider said.
    const row = await testDb.query.settings.findFirst()
    expect(row?.cloud).toMatchObject({ plan: 'free', billing: { status: 'canceled' } })
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
