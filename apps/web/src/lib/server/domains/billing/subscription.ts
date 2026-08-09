/**
 * Provider subscription -> plan, entitlements and numeric limits.
 *
 * This is the only place a provider concept becomes a product concept. It
 * writes through the seams the rest of the product already reads:
 * `writeCloudConfig()` for plan and billing references, `writeTierLimits()`
 * for the numeric caps. It never writes either column directly, and it never
 * touches enforcement.
 *
 * ## What billing writes, and what it does not
 *
 * Billing writes `cloud.enabled`, `cloud.plan` and `cloud.billing`. It
 * deliberately does **not** write `cloud.entitlements`. Entitlements follow
 * from the plan through `PLAN_CATALOGUE`, so moving the plan already moves
 * what is unlocked; the stored `entitlements` map exists for the *other*
 * writer's purpose — a negotiated or grandfathered workspace an operator
 * pinned in the config file. If billing wrote that map too, a subscription
 * change would quietly erase the operator's deal.
 *
 * ## Ordering
 *
 * Every path here re-fetches the subscription from the provider API rather
 * than trusting a webhook payload. That is what makes out-of-order delivery
 * harmless: two events arriving backwards both apply the same current state.
 * The residual race — two handlers fetching at different times and committing
 * in the wrong order — is closed by `snapshot_fetched_at`, which refuses a
 * snapshot older than the one already applied.
 */

import { and, billingSubscriptionState, db, eq, lt, sql } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { getCloudConfig, writeCloudConfig } from '../settings/cloud/cloud.service'
import { writeTierLimits } from '../settings/tier-limits.write'
import type { BillingStatus, CloudBilling } from '../settings/cloud/cloud.types'
import type { PlanId } from '../settings/cloud/cloud.types'
import type { TierLimits } from '../settings/tier-limits.types'
import {
  BILLING_PROVIDER,
  meterForPrice,
  planForPrice,
  type BillingConfig,
  type BillingMeter,
} from './billing.config'
import type { ProviderSubscription } from './provider/client'

const log = logger.child({ component: 'billing-subscription' })

/**
 * The plan a workspace falls back to when it has no live subscription.
 *
 * Not "no plan": a workspace on a billing-enabled deployment with no
 * subscription is a real commercial state (a signed-up tenant who has not
 * bought anything), and `isEntitled()` treats *enabled with no plan* as deny
 * everything. Free is the honest answer and the one that renders an upgrade
 * prompt instead of a dead end.
 */
export const UNSUBSCRIBED_PLAN: PlanId = 'free'

/**
 * Provider subscription statuses that entitle the workspace to its plan.
 *
 * `past_due` is included on purpose. A failed renewal is a commercial
 * problem, not an abuse signal, and cutting a paying customer off the moment
 * a card expires is both bad product and — per SAAS-HOSTING-STACK.md §8.1 —
 * the wrong failure direction for a gate that exists to sell things. The
 * provider's own dunning cycle ends in `canceled`, which does downgrade.
 */
const ENTITLING_STATUSES: ReadonlySet<BillingStatus> = new Set<BillingStatus>([
  'active',
  'trialing',
  'past_due',
])

/** Normalised view of a provider subscription, in this module's vocabulary. */
export interface SubscriptionSnapshot {
  subscriptionRef: string
  customerRef: string
  status: BillingStatus
  /** Plan resolved from the subscription's price ids, or null if unrecognised. */
  plan: PlanId | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  /** Subscription item id per meter, for quantity pushes. */
  items: Partial<Record<BillingMeter, { itemId: string; quantity: number }>>
  /**
   * Items the catalogue cannot account for — their price appears in no plan.
   *
   * Recorded rather than dropped, because "this meter has no item" and "this
   * meter's item is billing under a price I no longer recognise" are opposite
   * situations that used to be indistinguishable. Creating an item in the
   * second case duplicates a live charge; see `syncSeats`.
   */
  unaccountedItems: Array<{ itemId: string; priceId: string; licensed: boolean }>
  /** When this snapshot was read from the provider. */
  fetchedAt: Date
}

/**
 * Map a provider status onto the product's closed vocabulary.
 *
 * Unknown statuses map to `past_due` rather than `active`: a status this code
 * version has never heard of is, by construction, not one it can confirm as
 * paid, and `past_due` still entitles the plan (so nobody is cut off by a
 * vendor adding a status) while marking the workspace as needing attention.
 */
export function normalizeStatus(providerStatus: string): BillingStatus {
  switch (providerStatus) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'paused':
      return 'paused'
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled'
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due'
    default:
      log.warn({ providerStatus }, 'unrecognised provider subscription status')
      return 'past_due'
  }
}

/** Provider object -> snapshot. Pure, so the mapping is testable without a network. */
export function toSnapshot(
  subscription: ProviderSubscription,
  config: BillingConfig,
  fetchedAt: Date
): SubscriptionSnapshot {
  const items: SubscriptionSnapshot['items'] = {}
  const unaccountedItems: SubscriptionSnapshot['unaccountedItems'] = []
  let plan: PlanId | null = null

  for (const item of subscription.items?.data ?? []) {
    const priceId = item.price?.id
    if (!priceId) continue
    const itemPlan = planForPrice(config.catalogue, priceId)
    // The first recognised price decides the plan. A subscription mixing
    // prices from two plans is a provider-side configuration error, not a
    // state to model; it is logged and the first match wins so the workspace
    // keeps working.
    if (itemPlan && !plan) plan = itemPlan
    else if (itemPlan && plan && itemPlan !== plan) {
      log.error(
        { subscriptionRef: subscription.id, plan, itemPlan },
        'subscription mixes prices from two plans; keeping the first'
      )
    }
    const prices = itemPlan ? config.catalogue[itemPlan] : undefined
    const meter = prices ? meterForPrice(prices, priceId) : null
    if (meter) {
      items[meter] = { itemId: item.id, quantity: item.quantity ?? 0 }
      continue
    }
    // The price is in no plan in the catalogue. The overwhelmingly likely
    // cause is a rotated price: a price's amount is immutable at the provider,
    // so ANY repricing mints a new price object and retires the old one, while
    // existing subscriptions keep billing under the retired id.
    //
    // `licensed` distinguishes a seat line, which can be duplicated, from a
    // metered one, which carries no quantity and cannot. An item whose
    // `usage_type` the provider did not report is treated as licensed: the
    // conservative reading, because the cost of guessing wrong is a duplicate
    // charge rather than a skipped sync.
    unaccountedItems.push({
      itemId: item.id,
      priceId,
      licensed: item.price?.recurring?.usage_type !== 'metered',
    })
  }

  if (unaccountedItems.length > 0) {
    log.warn(
      { subscriptionRef: subscription.id, unaccountedItems },
      'subscription carries items whose price is in no plan; the catalogue may be out of step with a repricing'
    )
  }

  return {
    subscriptionRef: subscription.id,
    customerRef: subscription.customer,
    status: normalizeStatus(subscription.status),
    plan,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    items,
    unaccountedItems,
    fetchedAt,
  }
}

/**
 * Does this subscription's status entitle its plan?
 *
 * Exported so callers that act on the provider — rather than on the product's
 * own state — can ask before acting. `effectivePlan()` already encodes the
 * same rule for the plan decision; this exposes the predicate itself so a
 * second copy of the status list never appears.
 */
export function entitlesPlan(snapshot: SubscriptionSnapshot): boolean {
  return ENTITLING_STATUSES.has(snapshot.status)
}

/** The plan a snapshot entitles, after the status rule. */
export function effectivePlan(snapshot: SubscriptionSnapshot | null): PlanId {
  if (!snapshot) return UNSUBSCRIBED_PLAN
  if (!ENTITLING_STATUSES.has(snapshot.status)) return UNSUBSCRIBED_PLAN
  return snapshot.plan ?? UNSUBSCRIBED_PLAN
}

export interface ApplyResult {
  /** The plan now stored. */
  plan: PlanId
  /**
   * True when the plan could not be resolved from the subscription's prices
   * and the previously stored plan was kept rather than falling to Free.
   */
  planHeld: boolean
  cloudChanged: boolean
  limitsChanged: boolean
  /** True when the snapshot was refused as older than the applied one. */
  stale: boolean
}

/**
 * Apply a snapshot (or its absence) to the product's plan state.
 *
 * Idempotent end to end: both write seams no-op when nothing changed, so a
 * redelivered webhook, a reconcile tick and a manual refresh all converge on
 * the same row without churning it.
 *
 * ## A null snapshot clears the SUBSCRIPTION, never the CUSTOMER
 *
 * This distinction is load-bearing twice over.
 *
 * Commercially it is simply correct: a provider customer outlives every
 * subscription it ever holds. Cancelling ends a subscription; it does not
 * dissolve the account, its payment methods or its invoice history. Erasing
 * `customerRef` would throw away the "which account is this workspace"
 * answer that `CloudBilling` exists to hold — precisely what support needs
 * most when billing has gone wrong — and would orphan the customer at the
 * provider so the next upgrade silently created a second one.
 *
 * For safety it is worse than that. `ownsSubscription()` in
 * `webhook.service.ts` treats a workspace with no known customer as one that
 * may adopt whatever subscription it is next told about, because checkout
 * completes at the provider before any reference exists locally. An earlier
 * version nulled `customerRef` here, so **every cancellation reopened that
 * adoption window permanently**, and the reconcile sweep reopened it every
 * fifteen minutes for the entire unsubscribed population. A stranger's
 * routine subscription event was then adopted whole: their plan applied to
 * this workspace, this workspace's seat count pushed onto their subscription,
 * and their portal — invoices, card, cancellation — reachable from this
 * workspace's admin UI.
 */
export async function applySubscription(
  snapshot: SubscriptionSnapshot | null,
  config: BillingConfig
): Promise<ApplyResult> {
  if (snapshot && (await isStaleSnapshot(snapshot))) {
    log.info(
      { subscriptionRef: snapshot.subscriptionRef, fetchedAt: snapshot.fetchedAt },
      'refusing an older subscription snapshot; a newer one is already applied'
    )
    return {
      plan: effectivePlan(snapshot),
      planHeld: false,
      cloudChanged: false,
      limitsChanged: false,
      stale: true,
    }
  }

  const { plan, planHeld } = await resolvePlanToApply(snapshot)

  // `customerRef` is present in the patch only when there IS a snapshot. The
  // key is omitted rather than set to null on the empty path, because
  // `mergeCloudConfig` merges the billing block field by field — an explicit
  // null would overwrite the stored customer, an absent key leaves it alone.
  const billing: Partial<CloudBilling> = {
    provider: BILLING_PROVIDER,
    subscriptionRef: snapshot?.subscriptionRef ?? null,
    status: snapshot?.status ?? null,
    currentPeriodEnd: snapshot?.currentPeriodEnd ?? null,
  }
  if (snapshot) billing.customerRef = snapshot.customerRef

  const cloud = await writeCloudConfig(
    {
      // Turning the switch on is part of applying a subscription: a
      // deployment that has configured a billing provider has, by that act,
      // opted into plan gating. An install with no provider configured never
      // reaches this line, which is why the default stays off.
      enabled: true,
      plan,
      billing,
    },
    { writer: 'billing' }
  )

  const limits = (config.catalogue[plan]?.limits ?? null) as Partial<TierLimits> | null
  const limitsResult = await writeTierLimits(limits, { writer: 'billing' })

  if (snapshot) await recordSnapshot(snapshot)

  log.info(
    {
      plan,
      status: snapshot?.status ?? null,
      subscriptionRef: snapshot?.subscriptionRef ?? null,
      cloudChanged: cloud.changed,
      limitsChanged: limitsResult.changed,
    },
    'subscription applied'
  )

  return {
    plan,
    planHeld,
    cloudChanged: cloud.changed,
    limitsChanged: limitsResult.changed,
    stale: false,
  }
}

/**
 * The plan to write, which is `effectivePlan()` except in one case.
 *
 * ## Holding the last known plan
 *
 * `planForPrice` resolves a subscription's plan by looking its prices up in
 * the catalogue, so a subscription billing entirely under **retired** prices
 * resolves to no plan at all. `effectivePlan()` then reads `null` as "not on
 * a plan" and writes Free — and a paying customer loses every entitlement in
 * the product on the next webhook, while still paying the old price at the
 * provider.
 *
 * That is not exotic. A price's amount is immutable at the provider, so any
 * repricing mints a new price object; the trigger is an ordinary commercial
 * action, and it fires across the whole book at once.
 *
 * **The discriminator is whether anything is unaccounted, not whether the plan
 * is null.** A genuine downgrade or cancellation also produces no plan, and
 * falling to Free is exactly right there — the difference is that such a
 * subscription's items all resolve. Only when the subscription carries a
 * licensed item the catalogue cannot account for is `null` evidence of a stale
 * catalogue rather than of a customer who stopped paying.
 *
 * Two further conditions keep the hold narrow. The status must still entitle
 * the plan, so a cancellation is never held. And there must be a stored plan
 * to hold — a workspace that never had one falls to Free as before.
 */
async function resolvePlanToApply(
  snapshot: SubscriptionSnapshot | null
): Promise<{ plan: PlanId; planHeld: boolean }> {
  const resolved = effectivePlan(snapshot)
  if (!snapshot) return { plan: resolved, planHeld: false }
  if (snapshot.plan !== null) return { plan: resolved, planHeld: false }
  if (!entitlesPlan(snapshot)) return { plan: resolved, planHeld: false }
  if (!snapshot.unaccountedItems.some((item) => item.licensed)) {
    return { plan: resolved, planHeld: false }
  }

  const current = await getCloudConfig()
  if (!current.plan) return { plan: resolved, planHeld: false }

  log.warn(
    {
      subscriptionRef: snapshot.subscriptionRef,
      heldPlan: current.plan,
      unaccountedItems: snapshot.unaccountedItems,
    },
    'subscription resolves to no plan but carries unaccounted licensed items; holding the last known plan rather than downgrading'
  )
  return { plan: current.plan, planHeld: true }
}

/**
 * Whether a newer snapshot of the same subscription has already been applied.
 *
 * The guard is on the *fetch* time, not the provider's event timestamp:
 * events carry a one-second-resolution creation time and can be created in
 * the same second, whereas the fetch time is this process's own millisecond
 * clock at the moment it read authoritative state.
 */
async function isStaleSnapshot(snapshot: SubscriptionSnapshot): Promise<boolean> {
  const [row] = await db
    .select({ snapshotFetchedAt: billingSubscriptionState.snapshotFetchedAt })
    .from(billingSubscriptionState)
    .where(eq(billingSubscriptionState.subscriptionRef, snapshot.subscriptionRef))
    .limit(1)
  if (!row) return false
  return row.snapshotFetchedAt > snapshot.fetchedAt
}

/**
 * Record the applied snapshot.
 *
 * The WHERE clause on the update half is the real guard: two handlers that
 * both passed `isStaleSnapshot` can still commit in the wrong order, and this
 * makes the older one's write a no-op instead of a regression.
 */
async function recordSnapshot(snapshot: SubscriptionSnapshot): Promise<void> {
  await db
    .insert(billingSubscriptionState)
    .values({
      subscriptionRef: snapshot.subscriptionRef,
      provider: BILLING_PROVIDER,
      customerRef: snapshot.customerRef,
      snapshotFetchedAt: snapshot.fetchedAt,
      syncedQuantities: {},
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: billingSubscriptionState.subscriptionRef,
      set: {
        customerRef: snapshot.customerRef,
        snapshotFetchedAt: snapshot.fetchedAt,
        updatedAt: new Date(),
      },
      where: lt(billingSubscriptionState.snapshotFetchedAt, snapshot.fetchedAt),
    })
}

/**
 * Quantities last pushed for one specific subscription.
 *
 * Keyed by subscription ref rather than read off "the most recently updated
 * row". `billing_subscription_state` can legitimately hold more than one row
 * — a row is written per subscription reference seen, and only an explicit
 * deletion removes one — so the newest row is not necessarily the one being
 * synced. Reading the wrong row makes `syncSeats` believe nothing has been
 * pushed and re-push an unchanged seat count, which at the provider is a
 * redundant proration event on a real invoice.
 */
export async function syncedQuantitiesFor(
  subscriptionRef: string
): Promise<Record<string, number>> {
  const [row] = await db
    .select({ syncedQuantities: billingSubscriptionState.syncedQuantities })
    .from(billingSubscriptionState)
    .where(eq(billingSubscriptionState.subscriptionRef, subscriptionRef))
    .limit(1)
  return (row?.syncedQuantities ?? {}) as Record<string, number>
}

/** Record the quantities last pushed, so an unchanged seat count is a no-op. */
export async function recordSyncedQuantities(
  subscriptionRef: string,
  quantities: Record<string, number>
): Promise<void> {
  await db
    .update(billingSubscriptionState)
    .set({ syncedQuantities: quantities, updatedAt: new Date() })
    .where(eq(billingSubscriptionState.subscriptionRef, subscriptionRef))
}

/** The subscription reference this workspace is on, or null. */
export async function currentSubscriptionRef(): Promise<{
  subscriptionRef: string
  customerRef: string
  syncedQuantities: Record<string, number>
} | null> {
  const [row] = await db
    .select({
      subscriptionRef: billingSubscriptionState.subscriptionRef,
      customerRef: billingSubscriptionState.customerRef,
      syncedQuantities: billingSubscriptionState.syncedQuantities,
    })
    .from(billingSubscriptionState)
    // Tie-broken on the primary key. `updated_at` alone is not a total order:
    // two rows written in the same millisecond leave the winner up to the
    // planner, which is a coin-flip that shows up as an unreproducible test
    // failure long before anyone reasons about it.
    .orderBy(
      sql`${billingSubscriptionState.updatedAt} DESC, ${billingSubscriptionState.subscriptionRef} DESC`
    )
    .limit(1)
  if (!row) return null
  return {
    subscriptionRef: row.subscriptionRef,
    customerRef: row.customerRef,
    syncedQuantities: (row.syncedQuantities ?? {}) as Record<string, number>,
  }
}

/** Forget a subscription entirely (cancellation reaching its terminal state). */
export async function forgetSubscription(subscriptionRef: string): Promise<void> {
  await db
    .delete(billingSubscriptionState)
    .where(and(eq(billingSubscriptionState.subscriptionRef, subscriptionRef)))
}
