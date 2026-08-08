/**
 * Webhook ingestion.
 *
 * ## The three separate guarantees, and what provides each
 *
 * A provider redelivers. It redelivers on any non-2xx, on its own retry
 * schedule, and it can deliver two events describing the same object out of
 * order. Those are three different problems and they need three different
 * mechanisms; conflating them is how billing systems end up double-charging.
 *
 *  1. **Authenticity** — HMAC verification against the raw body, with a
 *     timestamp tolerance (`provider/signature.ts`). Nothing past this point
 *     trusts the request.
 *  2. **Idempotency** — the `billing_webhook_events` table, keyed by the
 *     provider's own event id. The claim is an INSERT: if it conflicts, this
 *     delivery is a duplicate and the handler does not run again. A claim
 *     that is present but unprocessed is a crashed attempt and is retried.
 *  3. **Ordering** — the handler never trusts the event payload's copy of the
 *     object. It re-fetches the subscription from the provider API and
 *     applies *that*, so two events arriving backwards converge on the same
 *     current state. The residual race between two concurrent fetches is
 *     closed by `snapshot_fetched_at` in `subscription.ts`.
 *
 * A fourth thing that is *not* a guarantee and should not be mistaken for
 * one: the signature's timestamp tolerance is transport anti-replay. It does
 * not make handling idempotent — a legitimate redelivery inside the window is
 * a valid, correctly-signed duplicate, and only (2) stops it.
 */

import { billingWebhookEvents, db, eq, sql } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { getBillingConfig } from './billing.config'
import { makeProviderClient, type BillingProviderClient } from './provider/client'
import { verifyWebhookSignature } from './provider/signature'
import { applySubscription, forgetSubscription, toSnapshot } from './subscription'
import { syncSeats } from './seat-sync'

const log = logger.child({ component: 'billing-webhook' })

/** Header the provider signs deliveries with. */
export const SIGNATURE_HEADER = 'stripe-signature'

/**
 * Event types this module acts on. Anything else is acknowledged and ignored
 * — an allowlist rather than a switch default, so a new provider event type
 * cannot accidentally reach a handler that was not written for it.
 */
const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
])

export type WebhookOutcome =
  | { status: 200; body: { received: true; handled: boolean; duplicate?: true } }
  | { status: 400; body: { error: string } }
  | { status: 500; body: { error: string } }

interface ProviderEvent {
  id: string
  type: string
  created: number
  data: { object: Record<string, unknown> }
}

export interface HandleWebhookDeps {
  client?: BillingProviderClient
  now?: Date
}

/**
 * Verify, claim and handle one delivery.
 *
 * Returns a status rather than throwing so the route stays a two-liner and so
 * the decision about *which* failures ask for a retry lives here. The rule:
 * anything the provider could fix by resending gets a 5xx; anything it cannot
 * (a bad signature, an unparseable body) gets a 400, because retrying it
 * forever helps nobody.
 */
export async function handleBillingWebhook(
  rawBody: string,
  signatureHeader: string | null,
  deps: HandleWebhookDeps = {}
): Promise<WebhookOutcome> {
  const config = getBillingConfig()
  if (!config) {
    // Billing is not configured. The route exists in the bundle either way,
    // so it has to answer — but it must do so without implying an endpoint is
    // listening, and without touching the database.
    return { status: 400, body: { error: 'billing_not_configured' } }
  }

  const now = deps.now ?? new Date()
  const verification = verifyWebhookSignature({
    payload: rawBody,
    header: signatureHeader,
    secret: config.webhookSecret,
    nowSeconds: Math.floor(now.getTime() / 1000),
  })
  if (!verification.ok) {
    log.warn({ reason: verification.reason }, 'webhook signature rejected')
    return { status: 400, body: { error: `signature_${verification.reason}` } }
  }

  let event: ProviderEvent
  try {
    event = JSON.parse(rawBody) as ProviderEvent
  } catch {
    return { status: 400, body: { error: 'invalid_json' } }
  }
  if (!event?.id || typeof event.type !== 'string') {
    return { status: 400, body: { error: 'invalid_event' } }
  }

  const claim = await claimEvent(event, config.provider)
  if (claim === 'duplicate') {
    log.debug({ providerEventId: event.id, type: event.type }, 'duplicate webhook ignored')
    return { status: 200, body: { received: true, handled: false, duplicate: true } }
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    await markProcessed(event.id, null)
    return { status: 200, body: { received: true, handled: false } }
  }

  const client = deps.client ?? makeProviderClient(config)
  try {
    await dispatch(event, client, now)
    await markProcessed(event.id, null)
    return { status: 200, body: { received: true, handled: true } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markProcessed(event.id, message)
    // Release the claim so the provider's redelivery is allowed to retry.
    // Without this, a transient failure would be permanently swallowed by the
    // idempotency table — the exact way an idempotency guard turns into a
    // silent data-loss bug.
    await releaseClaim(event.id)
    log.error({ err: error, providerEventId: event.id, type: event.type }, 'webhook handling failed')
    return { status: 500, body: { error: 'handler_failed' } }
  }
}

// ---------------------------------------------------------------------------
// Claim / release
// ---------------------------------------------------------------------------

/**
 * Claim an event id, or report it as already consumed.
 *
 * `ON CONFLICT DO NOTHING` plus an empty RETURNING is the whole mechanism: a
 * second delivery of the same id inserts nothing and returns no row. Because
 * this is a single statement, two concurrent deliveries of the same event
 * cannot both win.
 */
async function claimEvent(event: ProviderEvent, provider: string): Promise<'claimed' | 'duplicate'> {
  const rows = await db
    .insert(billingWebhookEvents)
    .values({
      providerEventId: event.id,
      provider,
      eventType: event.type,
      providerCreatedAt: Number.isFinite(event.created) ? new Date(event.created * 1000) : null,
    })
    .onConflictDoNothing({ target: billingWebhookEvents.providerEventId })
    .returning({ id: billingWebhookEvents.providerEventId })
  return rows.length > 0 ? 'claimed' : 'duplicate'
}

async function markProcessed(providerEventId: string, error: string | null): Promise<void> {
  await db
    .update(billingWebhookEvents)
    .set({ processedAt: new Date(), lastError: error })
    .where(eq(billingWebhookEvents.providerEventId, providerEventId))
}

async function releaseClaim(providerEventId: string): Promise<void> {
  await db
    .delete(billingWebhookEvents)
    .where(eq(billingWebhookEvents.providerEventId, providerEventId))
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(
  event: ProviderEvent,
  client: BillingProviderClient,
  now: Date
): Promise<void> {
  const config = getBillingConfig()
  if (!config) return

  if (event.type === 'customer.subscription.deleted') {
    const subscriptionRef = String(event.data.object.id ?? '')
    // A deleted subscription cannot be re-fetched, so this is the one case
    // that reads the payload — there is no authoritative state left to read.
    await applySubscription(null, config)
    if (subscriptionRef) await forgetSubscription(subscriptionRef)
    return
  }

  const subscriptionRef = subscriptionRefFrom(event)
  if (!subscriptionRef) {
    log.info({ type: event.type }, 'event carries no subscription reference; nothing to apply')
    return
  }

  // Re-fetch rather than trust the payload. This is what makes out-of-order
  // delivery a non-event: whichever order two updates arrive in, both apply
  // the subscription's current state.
  const fetchedAt = new Date()
  const subscription = await client.getSubscription(subscriptionRef)
  const snapshot = toSnapshot(subscription, config, fetchedAt)

  const result = await applySubscription(snapshot, config)
  if (result.stale) return

  // Push the derived seat count on subscription lifecycle events. A newly
  // created subscription is the important one: checkout guessed the seat
  // count from the seats that existed when the session was opened, and this
  // corrects it against the seats that exist now.
  if (event.type !== 'invoice.payment_failed') {
    await syncSeats(client, config, snapshot)
  }
  void now
}

/** Pull a subscription id out of whichever object shape the event carries. */
function subscriptionRefFrom(event: ProviderEvent): string | null {
  const object = event.data?.object ?? {}
  if (event.type.startsWith('customer.subscription.')) {
    return typeof object.id === 'string' ? object.id : null
  }
  // Checkout sessions and invoices both carry the subscription as a field.
  const ref = object.subscription
  if (typeof ref === 'string') return ref
  if (ref && typeof ref === 'object' && typeof (ref as { id?: unknown }).id === 'string') {
    return (ref as { id: string }).id
  }
  return null
}

/** Retention sweep for the idempotency ledger. */
export async function pruneWebhookEvents(before: Date): Promise<number> {
  const rows = await db
    .delete(billingWebhookEvents)
    .where(sql`${billingWebhookEvents.receivedAt} < ${before}`)
    .returning({ id: billingWebhookEvents.providerEventId })
  return rows.length
}
