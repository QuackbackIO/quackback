/**
 * Webhook ingestion.
 *
 * ## The four separate guarantees, and what provides each
 *
 * A provider redelivers. It redelivers on any non-2xx, on its own retry
 * schedule, it can deliver two events describing the same object out of
 * order, and — the one that is least obvious — it delivers events about
 * **every customer in the operator's account**, not just this workspace's.
 * Those are four different problems needing four different mechanisms;
 * conflating them is how billing systems end up double-charging, or charging
 * the wrong party.
 *
 *  1. **Authenticity** — HMAC verification against the raw body, with a
 *     timestamp tolerance (`provider/signature.ts`). Nothing past this point
 *     trusts the request.
 *  2. **Ownership** — the event's subject must be *this workspace's*
 *     customer. See below; this is the check whose absence is a cross-tenant
 *     defect rather than a robustness gap.
 *  3. **Idempotency** — the `billing_webhook_events` table, keyed by the
 *     provider's own event id. The claim is an upsert guarded on
 *     `processed_at IS NULL` plus a stale lease, so a completed event is a
 *     duplicate, an in-flight one is a duplicate, and only a *crashed*
 *     attempt is retried.
 *  4. **Ordering** — the handler never trusts the event payload's copy of the
 *     object. It re-fetches the subscription from the provider API and
 *     applies *that*, so two events arriving backwards converge on the same
 *     current state. The residual race between two concurrent fetches is
 *     closed by `snapshot_fetched_at` in `subscription.ts`.
 *
 * ## Why ownership cannot be inferred from the signature
 *
 * A webhook endpoint subscribes to event **types**, never to customers, and
 * the endpoint secret authenticates the *endpoint* rather than the subject.
 * Under one operator account with a per-tenant endpoint URL, every tenant's
 * endpoint receives every other tenant's subscription events, each correctly
 * signed for the endpoint that receives it. "Correctly signed" therefore
 * means "really from the provider", never "about us".
 *
 * Without the check, one ordinary delivery moves this workspace's plan to
 * whatever a stranger bought, pushes this workspace's seat count onto the
 * stranger's subscription (changing their invoice), and — because
 * `currentSubscriptionRef()` orders by `updated_at` — makes "Manage billing"
 * open the stranger's portal, invoices and card.
 *
 * The check runs on the **re-fetched** subscription, not the event payload,
 * for the same reason the ordering guarantee does: the payload is a claim,
 * the API response is the fact.
 *
 * A fifth thing that is *not* a guarantee and should not be mistaken for one:
 * the signature's timestamp tolerance is transport anti-replay. It does not
 * make handling idempotent — a legitimate redelivery inside the window is a
 * valid, correctly-signed duplicate, and only (3) stops it.
 */

import { and, billingWebhookEvents, db, eq, isNull, lt } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { getCloudConfig } from '../settings/cloud/cloud.service'
import { getBillingConfig } from './billing.config'
import { makeProviderClient, type BillingProviderClient } from './provider/client'
import { verifyWebhookSignature } from './provider/signature'
import {
  applySubscription,
  currentSubscriptionRef,
  forgetSubscription,
  toSnapshot,
} from './subscription'
import { syncSeats } from './seat-sync'

const log = logger.child({ component: 'billing-webhook' })

/**
 * Header the provider signs deliveries with.
 *
 * A wire-protocol constant: its spelling is fixed by the provider, not chosen
 * here, which is why it is the one string in this module that carries a
 * vendor name.
 */
export const SIGNATURE_HEADER = 'stripe-signature'

/**
 * How long a claimed-but-unfinished delivery is assumed to still be running.
 *
 * The window separates two states the claim row cannot otherwise tell apart:
 * a handler that is mid-flight (must not be run a second time concurrently)
 * and one whose process died between claiming and releasing (must be retried,
 * or the event is stranded forever). The handler makes at most a few provider
 * calls, so minutes is generous; the provider's own retry horizon is days, so
 * a reclaim always has redeliveries left to ride in on.
 */
export const CLAIM_LEASE_MS = 5 * 60 * 1000

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
  | {
      status: 200
      body: { received: true; handled: boolean; duplicate?: true; foreign?: true }
    }
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

  const claim = await claimEvent(event, config.provider, now)
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
    const outcome = await dispatch(event, client)
    await markProcessed(event.id, null)
    if (outcome === 'foreign') {
      // Acknowledged, deliberately. The delivery is legitimate and correctly
      // signed — it is simply about someone else — so a non-2xx would make
      // the provider retry it on a schedule forever. Recording it as
      // processed also means the redelivery short-circuits on the ledger
      // rather than re-fetching a subscription that will never be ours.
      return { status: 200, body: { received: true, handled: false, foreign: true } }
    }
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
 * One statement, so two concurrent deliveries of the same event cannot both
 * win: the conflicting one takes a row lock on the existing row and its
 * `WHERE` decides the outcome.
 *
 * The `WHERE` distinguishes three states a bare `ON CONFLICT DO NOTHING`
 * collapses into one:
 *
 * - **completed** (`processed_at` set) — a duplicate. Do nothing.
 * - **in flight** (`processed_at` NULL, claimed recently) — a duplicate.
 *   Running the handler alongside itself would push seat quantities twice and
 *   race the snapshot guard for no benefit.
 * - **crashed** (`processed_at` NULL, claimed longer ago than the lease) —
 *   reclaimed and retried. This is the state the previous implementation had
 *   no way to express: the normal error path releases the claim, but a pod
 *   kill, an OOM or a failing `releaseClaim` left the row behind and every
 *   subsequent redelivery was answered "duplicate" while nothing had ever
 *   been applied. The event was stranded permanently, silently.
 */
async function claimEvent(
  event: ProviderEvent,
  provider: string,
  now: Date
): Promise<'claimed' | 'duplicate'> {
  const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS)
  const rows = await db
    .insert(billingWebhookEvents)
    .values({
      providerEventId: event.id,
      provider,
      eventType: event.type,
      providerCreatedAt: Number.isFinite(event.created) ? new Date(event.created * 1000) : null,
      receivedAt: now,
    })
    .onConflictDoUpdate({
      target: billingWebhookEvents.providerEventId,
      set: { receivedAt: now, lastError: null },
      where: and(
        isNull(billingWebhookEvents.processedAt),
        lt(billingWebhookEvents.receivedAt, staleBefore)
      ),
    })
    .returning({ id: billingWebhookEvents.providerEventId })

  if (rows.length === 0) return 'duplicate'
  return 'claimed'
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

type DispatchOutcome = 'applied' | 'foreign' | 'ignored'

async function dispatch(
  event: ProviderEvent,
  client: BillingProviderClient
): Promise<DispatchOutcome> {
  const config = getBillingConfig()
  if (!config) return 'ignored'

  const identity = await workspaceBillingIdentity()

  if (event.type === 'customer.subscription.deleted') {
    // The one path that cannot re-fetch: the object is gone, so there is no
    // authoritative state left to read and the payload is all there is. That
    // makes the ownership check here MORE important rather than less — a
    // stranger's cancellation would otherwise downgrade this workspace to
    // Free, which is the most damaging thing an unowned event can do.
    const subscriptionRef = str(event.data.object.id)
    const customerRef = str(event.data.object.customer)
    const ours =
      (identity.subscriptionRef !== null && subscriptionRef === identity.subscriptionRef) ||
      (identity.customerRef !== null && customerRef === identity.customerRef)
    if (!ours) {
      logForeign(event, customerRef, identity.customerRef)
      return 'foreign'
    }
    await applySubscription(null, config)
    if (subscriptionRef) await forgetSubscription(subscriptionRef)
    return 'applied'
  }

  const subscriptionRef = subscriptionRefFrom(event)
  if (!subscriptionRef) {
    log.info({ type: event.type }, 'event carries no subscription reference; nothing to apply')
    return 'ignored'
  }

  // Re-fetch rather than trust the payload. This is what makes out-of-order
  // delivery a non-event: whichever order two updates arrive in, both apply
  // the subscription's current state. It is also what makes the ownership
  // check below trustworthy — a payload can claim any customer it likes.
  const fetchedAt = new Date()
  const subscription = await client.getSubscription(subscriptionRef)
  const snapshot = toSnapshot(subscription, config, fetchedAt)

  if (!ownsSubscription(identity, snapshot.customerRef)) {
    logForeign(event, snapshot.customerRef, identity.customerRef)
    return 'foreign'
  }

  const result = await applySubscription(snapshot, config)
  if (result.stale) return 'applied'

  // Push the derived seat count on subscription lifecycle events. A newly
  // created subscription is the important one: checkout guessed the seat
  // count from the seats that existed when the session was opened, and this
  // corrects it against the seats that exist now.
  if (event.type !== 'invoice.payment_failed') {
    await syncSeats(client, config, snapshot)
  }
  return 'applied'
}

interface BillingIdentity {
  customerRef: string | null
  subscriptionRef: string | null
}

/**
 * Who this workspace is, to the provider.
 *
 * `settings.cloud.billing` is the product-side record and the one support
 * reads, so it leads; `billing_subscription_state` is the fallback for the
 * window between a subscription being recorded and the cloud block being
 * written.
 */
async function workspaceBillingIdentity(): Promise<BillingIdentity> {
  const cloud = await getCloudConfig()
  if (cloud.billing.customerRef) {
    return {
      customerRef: cloud.billing.customerRef,
      subscriptionRef: cloud.billing.subscriptionRef,
    }
  }
  const stored = await currentSubscriptionRef()
  return {
    customerRef: stored?.customerRef ?? null,
    subscriptionRef: stored?.subscriptionRef ?? null,
  }
}

/**
 * Is `customerRef` this workspace's?
 *
 * A workspace with no customer yet **adopts** the first subscription it is
 * told about. That carve-out is necessary, not lax: checkout completes at the
 * provider before any reference exists locally, so the very first event has
 * nothing to compare against and rejecting it would make self-serve signup
 * impossible. The window closes the moment a customer is known — which is at
 * the end of that same first event — so it cannot be used to walk in later.
 *
 * The residual exposure is narrow and worth stating plainly: a foreign event
 * arriving in the gap between "this workspace has no customer" and "its own
 * checkout completes" would be adopted. Closing it entirely needs the
 * customer to be created before checkout rather than discovered from the
 * webhook — which `ensureCustomer()` already does on the self-serve path, so
 * in practice the gap only exists for a workspace whose subscription was
 * created out of band.
 */
function ownsSubscription(identity: BillingIdentity, customerRef: string | null): boolean {
  if (identity.customerRef === null) return true
  return customerRef !== null && customerRef === identity.customerRef
}

function logForeign(event: ProviderEvent, eventCustomer: string | null, ours: string | null): void {
  // Warn, not debug. This is expected traffic on a shared operator account,
  // but a sudden change in its volume or a burst against one tenant is worth
  // seeing, and silence here is what made the original defect invisible.
  log.warn(
    {
      providerEventId: event.id,
      type: event.type,
      eventCustomerRef: eventCustomer,
      workspaceCustomerRef: ours,
    },
    'webhook is for a different customer; acknowledged without applying'
  )
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
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
