/**
 * The billing module's outward surface: what the admin UI reads and the
 * actions it can take.
 *
 * Everything here answers `null` or a no-op when billing is unconfigured, so
 * no caller needs to know whether the feature exists. That is the mechanism
 * behind "default off is today's behaviour": the surfaces are not
 * conditionally compiled, they are conditionally *empty*.
 */

import { logger } from '@/lib/server/logger'
import { config as appConfig } from '@/lib/server/config'
import { getCloudConfig } from '../settings/cloud/cloud.service'
import { PLAN_CATALOGUE, type PlanId } from '../settings/cloud/cloud.types'
import { listEntitlements } from '../settings/cloud/entitlements'
import { getBillingConfig, type BillingConfig } from './billing.config'
import { makeProviderClient, type BillingProviderClient } from './provider/client'
import { checkoutLineItems, syncSeats } from './seat-sync'
import { countSeats, type SeatCounts } from './seats'
import { applySubscription, currentSubscriptionRef, toSnapshot } from './subscription'
import { deriveOutcomeUsage, pushOutcomeUsage, usageSummary } from './usage'

const log = logger.child({ component: 'billing-service' })

/** Invoice list length on the admin surface. */
const INVOICE_LIMIT = 12

export interface BillingInvoice {
  id: string
  number: string | null
  status: string | null
  /** Minor units, as the provider reports them. */
  total: number
  currency: string
  createdAt: string
  hostedUrl: string | null
  pdfUrl: string | null
}

export interface BillingPaymentMethod {
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

export interface BillingOverview {
  /** Which plans this deployment sells, cheapest first. */
  purchasablePlans: Array<{ id: PlanId; name: string; grants: string[] }>
  plan: PlanId | null
  planName: string | null
  status: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  seats: SeatCounts
  entitlements: Record<string, boolean>
  usage: { total: number; reported: number; pending: number }
  invoices: BillingInvoice[]
  paymentMethod: BillingPaymentMethod | null
  /** True once a subscription exists, so the UI can offer manage vs buy. */
  hasSubscription: boolean
  /** Only present in the provider's own dashboard sense; never an id. */
  livemode: boolean
}

/**
 * Everything the admin billing page renders.
 *
 * Returns `null` when billing is unconfigured, which the route turns into "no
 * billing page". Note what is deliberately absent from this shape: no
 * customer reference, no subscription reference, no price ids, no API key.
 * The page needs to *show* a plan and a card, not to *address* the provider —
 * every action that needs an identifier resolves it server-side.
 */
export async function getBillingOverview(): Promise<BillingOverview | null> {
  const config = getBillingConfig()
  if (!config) return null

  const cloud = await getCloudConfig()
  const [seats, entitlements, stored] = await Promise.all([
    countSeats(),
    listEntitlements(),
    currentSubscriptionRef(),
  ])

  let invoices: BillingInvoice[] = []
  let paymentMethod: BillingPaymentMethod | null = null
  let cancelAtPeriodEnd = false

  if (stored) {
    const client = makeProviderClient(config)
    // Provider reads are best-effort: an outage must degrade the page to
    // "plan and seats, no invoice history" rather than break it. This is a
    // commercial surface, and the same failure direction §8.1 argues for.
    const [invoiceResult, methodResult, subscriptionResult] = await Promise.allSettled([
      client.listInvoices(stored.customerRef, INVOICE_LIMIT),
      client.listPaymentMethods(stored.customerRef),
      client.getSubscription(stored.subscriptionRef),
    ])
    if (invoiceResult.status === 'fulfilled') {
      invoices = invoiceResult.value.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        total: invoice.total,
        currency: invoice.currency,
        createdAt: new Date(invoice.created * 1000).toISOString(),
        hostedUrl: invoice.hosted_invoice_url,
        pdfUrl: invoice.invoice_pdf,
      }))
    } else {
      log.warn({ err: invoiceResult.reason }, 'invoice list unavailable')
    }
    if (methodResult.status === 'fulfilled') {
      const card = methodResult.value.find((method) => method.card)?.card
      if (card) {
        paymentMethod = {
          brand: card.brand,
          last4: card.last4,
          expMonth: card.exp_month,
          expYear: card.exp_year,
        }
      }
    }
    if (subscriptionResult.status === 'fulfilled') {
      cancelAtPeriodEnd = subscriptionResult.value.cancel_at_period_end === true
    }
  }

  const since = startOfPeriod(cloud.billing.currentPeriodEnd)
  const usage = await usageSummary(since)

  return {
    purchasablePlans: Object.keys(config.catalogue)
      .filter((id): id is PlanId => id in PLAN_CATALOGUE)
      .map((id) => PLAN_CATALOGUE[id])
      .sort((a, b) => a.rank - b.rank)
      .map((plan) => ({ id: plan.id, name: plan.name, grants: [...plan.grants] })),
    plan: cloud.plan,
    planName: cloud.plan ? PLAN_CATALOGUE[cloud.plan].name : null,
    status: cloud.billing.status,
    currentPeriodEnd: cloud.billing.currentPeriodEnd,
    cancelAtPeriodEnd,
    seats,
    entitlements,
    usage,
    invoices,
    paymentMethod,
    hasSubscription: stored !== null,
    livemode: config.livemode,
  }
}

/**
 * The usage window shown on the page.
 *
 * Anchored on the subscription's period end minus a month rather than the
 * calendar month, because that is the window the customer is actually billed
 * over. Falls back to 30 days when there is no subscription yet.
 */
function startOfPeriod(currentPeriodEnd: string | null): Date {
  if (currentPeriodEnd) {
    const end = new Date(currentPeriodEnd)
    if (!Number.isNaN(end.getTime())) {
      const start = new Date(end)
      start.setUTCMonth(start.getUTCMonth() - 1)
      return start
    }
  }
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export class BillingNotConfiguredError extends Error {
  constructor() {
    super('Billing is not configured for this deployment.')
    this.name = 'BillingNotConfiguredError'
  }
}

/**
 * Start a self-serve upgrade.
 *
 * The seat quantities are derived here, at session creation, from the same
 * count the invoice will use — so the checkout page shows the customer the
 * real number rather than asking them to type one. The webhook re-derives
 * afterwards, which corrects for seats added while the customer was on the
 * payment page.
 */
export async function startCheckout(input: {
  plan: PlanId
  actorEmail: string | null
  returnPath: string
}): Promise<{ url: string }> {
  const config = getBillingConfig()
  if (!config) throw new BillingNotConfiguredError()
  if (!config.catalogue[input.plan]) {
    throw new Error(`Plan "${input.plan}" is not sold by this deployment.`)
  }

  const client = makeProviderClient(config)
  const customerRef = await ensureCustomer(client, input.actorEmail)
  const seats = await countSeats()
  const lineItems = checkoutLineItems(config, input.plan, seats)

  const base = config.returnUrl || appConfig.baseUrl
  const session = await client.createCheckoutSession({
    customer: customerRef,
    lineItems,
    successUrl: `${base}${input.returnPath}?checkout=done`,
    cancelUrl: `${base}${input.returnPath}?checkout=cancelled`,
    metadata: { plan: input.plan },
    // Keyed on the intent, so a double-clicked upgrade button reuses one
    // session instead of opening two subscriptions.
    idempotencyKey: `checkout:${customerRef}:${input.plan}:${seats.full}:${seats.lite}:${seats.copilot}`,
  })

  if (!session.url) throw new Error('Provider returned a checkout session with no URL.')
  return { url: session.url }
}

/** Open the provider's own management surface (cards, cancellation, receipts). */
export async function openBillingPortal(returnPath: string): Promise<{ url: string }> {
  const config = getBillingConfig()
  if (!config) throw new BillingNotConfiguredError()
  const stored = await currentSubscriptionRef()
  if (!stored) throw new Error('This workspace has no subscription to manage.')

  const client = makeProviderClient(config)
  const base = config.returnUrl || appConfig.baseUrl
  const session = await client.createPortalSession({
    customer: stored.customerRef,
    returnUrl: `${base}${returnPath}`,
  })
  if (!session.url) throw new Error('Provider returned a portal session with no URL.')
  return { url: session.url }
}

/**
 * Full reconcile: re-read the subscription, re-apply plan and limits, push
 * seat quantities, derive and report usage.
 *
 * The same routine the webhook path runs, callable on a timer and from the
 * admin page. Having one reconcile rather than two is what makes a missed
 * webhook a delay instead of a permanent divergence.
 */
export async function reconcileBilling(deps: { client?: BillingProviderClient } = {}): Promise<{
  reconciled: boolean
  plan: PlanId | null
}> {
  const config = getBillingConfig()
  if (!config) return { reconciled: false, plan: null }

  const client = deps.client ?? makeProviderClient(config)
  const stored = await currentSubscriptionRef()

  if (!stored) {
    // No subscription: still assert the unsubscribed plan, so a workspace on
    // a billing-enabled deployment is gated as Free rather than ungated.
    const result = await applySubscription(null, config)
    return { reconciled: true, plan: result.plan }
  }

  const fetchedAt = new Date()
  const subscription = await client.getSubscription(stored.subscriptionRef)
  const snapshot = toSnapshot(subscription, config, fetchedAt)
  const applied = await applySubscription(snapshot, config)
  await syncSeats(client, config, snapshot)
  await deriveOutcomeUsage()
  await pushOutcomeUsage(client, snapshot.customerRef, config, applied.plan)
  return { reconciled: true, plan: applied.plan }
}

/**
 * The provider customer for this workspace, created on first use.
 *
 * Stored on `settings.cloud.billing.customerRef` through the shared write
 * seam rather than in this module's own table, because it is the one billing
 * reference the *product* needs to know about — support answering "which
 * account is this workspace" should not need a second system, which is
 * exactly what the `CloudBilling` block was shaped for.
 */
async function ensureCustomer(
  client: BillingProviderClient,
  actorEmail: string | null
): Promise<string> {
  const cloud = await getCloudConfig()
  if (cloud.billing.customerRef) return cloud.billing.customerRef

  const created = await client.createCustomer({
    ...(actorEmail ? { email: actorEmail } : {}),
    metadata: { source: 'quackback' },
  })

  const { writeCloudConfig } = await import('../settings/cloud/cloud.service')
  await writeCloudConfig(
    { billing: { provider: 'stripe', customerRef: created.id } },
    { writer: 'billing' }
  )
  log.info('billing customer created')
  return created.id
}

/** Exported for the reconcile sweep and tests. */
export { syncSeats, countSeats }
export type { BillingConfig }
