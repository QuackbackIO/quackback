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
import { SEAT_METERS, type BillingConfig, type SeatMeter } from './billing.config'
import type { BillingProviderClient } from './provider/client'
import { countSeats, type SeatCounts } from './seats'
import {
  currentSubscriptionRef,
  recordSyncedQuantities,
  toSnapshot,
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

/** The quantity each seat meter should carry, given the counts. */
export function desiredQuantities(seats: SeatCounts): Record<SeatMeter, number> {
  return {
    fullSeat: seats.full,
    liteSeat: seats.lite,
    copilotSeat: seats.copilot,
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
  const desired = desiredQuantities(seats)

  if (!snapshot) return { skipped: true, unchanged: false, desired, seats }

  const stored = await currentSubscriptionRef()
  const synced = stored?.subscriptionRef === snapshot.subscriptionRef ? stored.syncedQuantities : {}

  const updates: Array<{ id: string; quantity: number }> = []
  for (const meter of SEAT_METERS) {
    const item = snapshot.items[meter]
    // A plan that does not sell this meter has no subscription item for it.
    // Skipping is correct: creating one would sell the customer something
    // their plan does not include.
    if (!item) continue
    const want = desired[meter]
    // Compare against the provider's own reported quantity as well as the
    // local record. The local record alone would be wrong after someone
    // changed the quantity in the provider's dashboard, and the provider
    // alone would re-push on every tick when an item is missing locally.
    if (item.quantity === want && synced[meter] === want) continue
    updates.push({ id: item.itemId, quantity: want })
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

/** Line items for a new checkout at `plan`, with quantities already derived. */
export function checkoutLineItems(
  config: BillingConfig,
  plan: PlanId,
  seats: SeatCounts
): Array<{ price: string; quantity?: number }> {
  const prices = config.catalogue[plan]
  if (!prices) return []
  const items: Array<{ price: string; quantity?: number }> = [
    // At least one full seat: the person running checkout is one, and a
    // subscription with a zero quantity on its only licensed item is rejected.
    { price: prices.seat, quantity: Math.max(1, seats.full) },
  ]
  if (prices.liteSeat && seats.lite > 0) {
    items.push({ price: prices.liteSeat, quantity: seats.lite })
  }
  if (prices.copilotSeat && seats.copilot > 0) {
    items.push({ price: prices.copilotSeat, quantity: seats.copilot })
  }
  // Metered items carry no quantity — the provider rejects a checkout session
  // that gives one.
  if (prices.outcome) items.push({ price: prices.outcome })
  return items
}

/** Re-derive a snapshot from a provider subscription. Convenience for callers. */
export function snapshotFrom(
  subscription: Parameters<typeof toSnapshot>[0],
  config: BillingConfig,
  fetchedAt: Date
): SubscriptionSnapshot {
  return toSnapshot(subscription, config, fetchedAt)
}
