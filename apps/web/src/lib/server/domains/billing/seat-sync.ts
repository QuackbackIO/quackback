/**
 * Keep the provider's seat quantities equal to the product's own seat count.
 *
 * The direction of authority is the whole point of moving billing into the
 * product: **the product's count is the truth and the provider is told about
 * it**, never the reverse. Today's arrangement — a seat change propagating to
 * a control plane, into the provider, and back as limits — has latency and
 * drift on the one number the invoice is computed from.
 *
 * Idempotent by construction: quantities are *declarative*, so pushing the
 * same number twice is a no-op at the provider, and the locally recorded
 * `syncedQuantities` short-circuits the call entirely when nothing moved. A
 * quantity is the safe shape for this; a usage *event* would not be, which is
 * why outcomes get a ledger and seats do not.
 */

import { logger } from '@/lib/server/logger'
import {
  SEAT_METERS,
  priceForMeter,
  type BillingConfig,
  type PlanPrices,
  type SeatMeter,
} from './billing.config'
import type { BillingProviderClient } from './provider/client'
import { countSeats, type SeatCounts } from './seats'
import {
  recordSyncedQuantities,
  syncedQuantitiesFor,
  type SubscriptionSnapshot,
} from './subscription'
import type { PlanId } from '../settings/cloud/cloud.types'

const log = logger.child({ component: 'billing-seat-sync' })

export interface SeatSyncResult {
  /** No subscription to sync against. */
  skipped: boolean
  /** Quantities already matched; no provider call made. */
  unchanged: boolean
  desired: Record<SeatMeter, number>
  seats: SeatCounts
}

/**
 * The quantity each seat meter should carry — **the single derivation**, used
 * by checkout and by every subsequent sync.
 *
 * It takes the plan's prices, not just the counts, because one rule depends on
 * them: **a plan that does not sell a lite seat has no lite seats.** There is
 * no cheaper product to put those teammates on, so they are billed as full
 * seats. Without that rule an all-lite workspace on a seat-only plan produces
 * a checkout with no line items at all.
 *
 * `copilotSeat` is full seats, per the operator's rule that Copilot bills per
 * paid user per month. Lite seats are excluded — a read-only support viewer
 * has no write action for Copilot to assist — which is an assumption recorded
 * in BILLING.md and reversible here by switching to `total`.
 *
 * ## Why there is exactly one of these
 *
 * There used to be two. `checkoutLineItems()` applied `Math.max(1, full)` —
 * a floor, so a subscription is never created with a zero quantity on its only
 * licensed item — and this function used a bare `full`. They agree at every
 * value except zero, and zero is not hypothetical: narrowing "lite" to the
 * customer-support surface makes an **all-lite workspace** an ordinary
 * configuration (a feedback-only install that has adopted custom roles). Such
 * a workspace bought one full seat and one Copilot seat at checkout, and the
 * very first webhook pushed both to zero.
 *
 * Two tests each asserted one half of that contradiction and neither could see
 * the other. The floor is gone rather than duplicated: billing one seat when
 * nobody occupies one is a phantom charge, and "bills per paid user" cannot
 * mean "bills 1 when there are no paid users". A plan minimum, if the operator
 * wants one, belongs in the plan.
 */
export function billableQuantities(
  seats: SeatCounts,
  prices: PlanPrices | undefined
): Record<SeatMeter, number> {
  const sellsLite = Boolean(prices?.liteSeat)
  const fullSeat = sellsLite ? seats.full : seats.total
  return {
    fullSeat,
    liteSeat: sellsLite ? seats.lite : 0,
    copilotSeat: fullSeat,
  }
}

/**
 * Reconcile provider quantities with the derived seat count.
 *
 * `snapshot` is the current subscription; passing it in avoids a second fetch
 * on the webhook path, which has just read one.
 */
export async function syncSeats(
  client: BillingProviderClient,
  config: BillingConfig,
  snapshot: SubscriptionSnapshot | null
): Promise<SeatSyncResult> {
  const seats = await countSeats()
  const prices = snapshot?.plan ? config.catalogue[snapshot.plan] : undefined
  const desired = billableQuantities(seats, prices)

  if (!snapshot) return { skipped: true, unchanged: false, desired, seats }

  // Keyed on the subscription being synced. An earlier version read "the most
  // recently updated row" and compared its ref, which returns {} whenever any
  // other subscription row happens to be newer — and re-pushes an unchanged
  // seat count, which is a redundant proration event at the provider.
  const synced = await syncedQuantitiesFor(snapshot.subscriptionRef)

  const updates: Array<{ id?: string; price?: string; quantity: number }> = []
  for (const meter of SEAT_METERS) {
    const item = snapshot.items[meter]
    const want = desired[meter]

    if (item) {
      // Compare against the provider's own reported quantity as well as the
      // local record. The local record alone would be wrong after someone
      // changed the quantity in the provider's dashboard, and the provider
      // alone would re-push on every tick when an item is missing locally.
      if (item.quantity === want && synced[meter] === want) continue
      updates.push({ id: item.itemId, quantity: want })
      continue
    }

    // No item on the subscription for this meter.
    //
    // `copilotSeat` is never created here. The add-on is opt-in and is bought
    // at checkout; creating it on a sync would charge for it without anyone
    // choosing it, which is the exact defect the opt-in exists to prevent.
    if (meter === 'copilotSeat') continue
    // Nothing to bill yet.
    if (want <= 0) continue
    // Only a meter the plan actually sells. Creating anything else would sell
    // the customer something their plan does not include.
    const price = prices ? priceForMeter(prices, meter) : null
    if (!price) continue
    // A seat class that had a zero quantity at checkout has no item, so
    // without this the first teammate of that class would never be billed —
    // which is how removing the checkout floor could have quietly become a
    // revenue leak instead of a fix.
    updates.push({ price, quantity: want })
  }

  if (updates.length === 0) {
    return { skipped: false, unchanged: true, desired, seats }
  }

  // The idempotency key is derived from the subscription and the exact
  // quantities being requested, so a retry of the *same* intent is collapsed
  // by the provider while a genuinely different seat count is a new request.
  const idempotencyKey = `seats:${snapshot.subscriptionRef}:${SEAT_METERS.map(
    (m) => `${m}=${desired[m]}`
  ).join(',')}`

  await client.updateSubscriptionItems(snapshot.subscriptionRef, updates, idempotencyKey)
  await recordSyncedQuantities(snapshot.subscriptionRef, desired)

  log.info(
    { subscriptionRef: snapshot.subscriptionRef, desired, items: updates.length },
    'seat quantities pushed'
  )
  return { skipped: false, unchanged: false, desired, seats }
}

/** Optional extras a customer can choose to buy alongside a plan. */
export interface CheckoutAddOns {
  /**
   * Whether to buy the Copilot add-on.
   *
   * **Opt-in, and default false.** The add-on bills per paid user, so buying
   * it charges for every full seat — adding that line automatically, as an
   * earlier version did, would have sold it to the whole team on every
   * upgrade without the customer choosing it. A derived *quantity* is right;
   * a derived *purchase* is not.
   *
   * Note the asymmetry with `syncSeats()`, and that it is deliberate: the
   * sync only ever adjusts an item the subscription already has, so it cannot
   * introduce a charge. Purchase happens here and nowhere else.
   */
  copilot?: boolean
}

/** Line items for a new checkout at `plan`, with quantities already derived. */
export function checkoutLineItems(
  config: BillingConfig,
  plan: PlanId,
  seats: SeatCounts,
  addOns: CheckoutAddOns = {}
): Array<{ price: string; quantity?: number }> {
  const prices = config.catalogue[plan]
  if (!prices) return []

  // The same derivation the sync uses, so checkout and the first webhook
  // cannot disagree about what the workspace owes.
  const quantities = billableQuantities(seats, prices)
  const items: Array<{ price: string; quantity?: number }> = []

  // A licensed line with a zero quantity is rejected, so a meter with nothing
  // to bill is omitted rather than floored. `billableQuantities` guarantees at
  // least one licensed line: every teammate is a seat of one class or the
  // other, the person running checkout is a teammate, and a plan with no lite
  // price counts all of them as full.
  if (quantities.fullSeat > 0) {
    items.push({ price: prices.seat, quantity: quantities.fullSeat })
  }
  if (prices.liteSeat && quantities.liteSeat > 0) {
    items.push({ price: prices.liteSeat, quantity: quantities.liteSeat })
  }
  if (addOns.copilot === true && prices.copilotSeat && quantities.copilotSeat > 0) {
    items.push({ price: prices.copilotSeat, quantity: quantities.copilotSeat })
  }
  // Metered items carry no quantity — the provider rejects a checkout session
  // that gives one.
  if (prices.outcome) items.push({ price: prices.outcome })
  return items
}
