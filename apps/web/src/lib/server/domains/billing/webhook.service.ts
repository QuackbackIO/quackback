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
 *     customer. See below; this is the check whose absence is a cross-workspace
 *     defect rather than a robustness gap.
 *  3. **Idempotency** — the `billing_webhook_events` table, keyed by the
 *     provider's own event id. The claim is an upsert guarded on
 *     `processed_at IS NULL` plus a staleness lease, so a completed event is a
 *     duplicate, a recently-claimed one is a duplicate, and a *crashed*
 *     attempt is eventually retried rather than stranded. Note the lease
 *     reduces duplicate work but does not exclude it — see `CLAIM_LEASE_MS`
 *     for why that is inherent, and what makes the overlap safe.
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
 * Under one operator account with a per-workspace endpoint URL, every workspace's
 * endpoint receives every other workspace's subscription events, each correctly
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
import { WORKSPACE_STAMP_KEY, getBillingConfig } from './billing.config'
import { workspaceStamp } from './identity'
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
 * ## What this guarantees, and what it does not
 *
 * It guarantees that a **crashed** attempt is eventually retried rather than
 * stranded: a process killed between claiming and releasing leaves a row that
 * would otherwise answer "duplicate" forever while nothing was ever applied.
 *
 * It does **not** guarantee mutual exclusion. A fixed lease cannot: a handler
 * that is genuinely still running past the window — parked in a slow provider
 * call, say — is indistinguishable from a dead one, so a redelivery at
 * `CLAIM_LEASE_MS + 1s` reclaims it and both run. That is inherent to leasing
 * on a timeout rather than on liveness, and the window is chosen so it is
 * rare, not impossible.
 *
 * What makes the overlap harmless is that the work behind it is idempotent
 * independently of this lease. `applySubscription` writes through seams that
 * no-op when nothing changed and refuses an older snapshot;
 * `recordSyncedQuantities` makes the loser of a seat push a no-op; usage
 * events carry their own provider-side dedupe key. The lease reduces
 * duplicate work; it is the idempotence underneath that makes duplicate work
 * safe. Do not add a step here that relies on the lease for correctness.
 *
 * Five minutes: comfortably longer than a handler's few provider calls, and
 * far inside the provider's multi-day retry horizon, so a reclaimed event
 * always has redeliveries left to ride in on.
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
    log.error(
      { err: error, providerEventId: event.id, type: event.type },
      'webhook handling failed'
    )
    return { status: 500, body: { error: 'handler_failed' } }
  }
}

// ---------------------------------------------------------------------------
// Claim / release
// ---------------------------------------------------------------------------

/**
 * Claim an event id, or report it as already consumed.
 *
 * One statement, so two deliveries arriving at the same instant cannot both
 * win: the conflicting one takes a row lock and its `WHERE` decides.
 *
 * The `WHERE` distinguishes three states a bare `ON CONFLICT DO NOTHING`
 * collapses into one:
 *
 * - **completed** (`processed_at` set) — a duplicate. Do nothing, forever,
 *   regardless of age.
 * - **recently claimed** (`processed_at` NULL, inside the lease) — a
 *   duplicate. Very probably still running.
 * - **stale** (`processed_at` NULL, older than the lease) — reclaimed and
 *   retried. Usually a crash; occasionally a handler that is simply slow, in
 *   which case both run. See `CLAIM_LEASE_MS` for why that trade is made
 *   deliberately and what absorbs it.
 *
 * The state the previous implementation could not express is the third one:
 * the normal error path releases the claim, but a pod kill, an OOM or a
 * failing `releaseClaim` left the row behind, and every subsequent redelivery
 * was answered "duplicate" while nothing had ever been applied.
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
    // No adoption on this path, deliberately: a deletion for a customer this
    // workspace has never recorded cannot be about a subscription it holds,
    // and adopting one would only ever downgrade it to Free on a stranger's
    // cancellation.
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

  // Cheap pre-filter, purely to avoid burning provider quota.
  //
  // Under one operator account every workspace receives every other workspace's
  // events, so without this each workspace would spend a `getSubscription`
  // (and sometimes a `getCustomer`) on every event belonging to every other
  // workspace — N-times amplification against a per-account rate limit that
  // grows with the fleet.
  //
  // It reads the PAYLOAD, so it is a hint and nothing more: it can only
  // refuse, never approve. A payload claiming our customer still goes to the
  // authoritative check below.
  const claimedCustomer = str(event.data?.object?.customer)
  if (
    identity.customerRef !== null &&
    claimedCustomer !== null &&
    claimedCustomer !== identity.customerRef
  ) {
    logForeign(event, claimedCustomer, identity.customerRef)
    return 'foreign'
  }

  // Re-fetch rather than trust the payload. This is what makes out-of-order
  // delivery a non-event: whichever order two updates arrive in, both apply
  // the subscription's current state. It is also what makes the ownership
  // check below trustworthy — a payload can claim any customer it likes.
  const fetchedAt = new Date()
  const subscription = await client.getSubscription(subscriptionRef)
  const snapshot = toSnapshot(subscription, config, fetchedAt)

  if (!(await ownsSubscription(identity, snapshot.customerRef, client))) {
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
 * Two paths, and the second is the one that has to be earned rather than
 * assumed.
 *
 * **A known customer** is a plain equality check. This is the normal case:
 * `ensureCustomer()` records the customer before checkout opens, so by the
 * time any event arrives there is something to compare against.
 *
 * **No known customer** cannot be resolved locally — there is nothing to
 * compare — so it is resolved *at the provider*. `ensureCustomer()` stamps
 * the workspace id into the customer's metadata at creation, and adoption
 * requires that stamp to match. A customer this workspace did not create
 * carries no stamp, or someone else's, and is refused.
 *
 * An earlier version simply returned true here. Combined with a null-apply
 * that erased `customerRef`, that meant every cancellation — and every
 * fifteen-minute reconcile tick on an unsubscribed workspace — reopened the
 * window permanently, for the entire free population rather than for one
 * event. The stamp is what makes the remaining case decidable instead of
 * merely narrow.
 *
 * The residual gap is now a customer created **outside this module** — a
 * control-plane provisioning flow, say — which will be refused until it
 * writes the same stamp. That is the correct direction for an identity
 * question: a loud, diagnosable refusal rather than a silent adoption, and
 * the contract the provisioning side needs is one metadata key.
 */
async function ownsSubscription(
  identity: BillingIdentity,
  customerRef: string | null,
  client: BillingProviderClient
): Promise<boolean> {
  if (identity.customerRef !== null) {
    return customerRef !== null && customerRef === identity.customerRef
  }
  if (customerRef === null) return false

  // A lookup FAILURE is deliberately not caught here.
  //
  // "Cannot tell" and "told, and the answer is no" are different outcomes and
  // must not collapse into one. A stamp mismatch is definitive: the event is
  // foreign, gets acknowledged, and is recorded as consumed. A transient
  // lookup error is not an answer at all — swallowing it as `false` would
  // mark the event processed with no retry path, so a provider blip would
  // permanently drop a workspace's own first subscription. Letting it throw
  // puts it on the handler's error path, which releases the claim and answers
  // 500 so the provider redelivers.
  const customer = await client.getCustomer(customerRef)
  const stamp = customer.metadata?.[WORKSPACE_STAMP_KEY]
  if (typeof stamp !== 'string' || stamp.length === 0) {
    log.warn(
      { customerRef },
      'refusing to adopt a subscription: its customer carries no workspace stamp'
    )
    return false
  }
  return stamp === (await workspaceStamp())
}

function logForeign(event: ProviderEvent, eventCustomer: string | null, ours: string | null): void {
  // Warn, not debug. This is expected traffic on a shared operator account,
  // but a sudden change in its volume or a burst against one workspace is worth
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
