/**
 * Catalog Billing Service
 *
 * Manages subscription and invoice data in the catalog database.
 * This centralizes billing data, enabling:
 * - Webhooks to write directly without tenant context resolution
 * - Platform-level billing operations (revenue reports, subscription analytics)
 * - Explicit Stripe customer → workspace mapping
 */
import { cache } from 'react'
import { eq, desc } from 'drizzle-orm'
import { getCatalogDb, subscription, invoice, stripeCustomer } from '@/lib/catalog'
import type { CloudTier } from '@/lib/features'
import type Stripe from 'stripe'

// ============================================
// Types
// ============================================

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

export interface CatalogSubscription {
  id: string
  workspaceId: string
  stripeCustomerId: string
  stripeSubscriptionId: string | null
  tier: CloudTier
  status: SubscriptionStatus
  seatsIncluded: number
  seatsAdditional: number
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  trialStart: Date | null
  trialEnd: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface CatalogInvoice {
  id: string
  workspaceId: string
  stripeInvoiceId: string
  amountDue: number
  amountPaid: number
  currency: string
  status: InvoiceStatus
  invoiceUrl: string | null
  pdfUrl: string | null
  periodStart: Date | null
  periodEnd: Date | null
  createdAt: Date
}

// ============================================
// Stripe Customer Management
// ============================================

/**
 * Get workspaceId from Stripe customer ID
 * Used by webhooks to find the workspace for a subscription event
 */
export async function getWorkspaceIdFromStripeCustomer(
  stripeCustomerId: string
): Promise<string | null> {
  const catalogDb = getCatalogDb()
  const result = await catalogDb.query.stripeCustomer.findFirst({
    where: eq(stripeCustomer.stripeCustomerId, stripeCustomerId),
  })
  return result?.workspaceId ?? null
}

/**
 * Upsert Stripe customer → workspace mapping
 * Creates or updates the mapping used for webhook lookups
 */
export async function upsertStripeCustomer(
  stripeCustomerId: string,
  workspaceId: string,
  email?: string
): Promise<void> {
  const catalogDb = getCatalogDb()

  // Check if mapping exists
  const existing = await catalogDb.query.stripeCustomer.findFirst({
    where: eq(stripeCustomer.stripeCustomerId, stripeCustomerId),
  })

  if (existing) {
    // Update if workspace or email changed
    if (existing.workspaceId !== workspaceId || (email && existing.email !== email)) {
      await catalogDb
        .update(stripeCustomer)
        .set({
          workspaceId,
          email: email ?? existing.email,
        })
        .where(eq(stripeCustomer.stripeCustomerId, stripeCustomerId))
    }
  } else {
    // Create new mapping
    await catalogDb.insert(stripeCustomer).values({
      stripeCustomerId,
      workspaceId,
      email,
    })
  }
}

// ============================================
// Subscription Management
// ============================================

/**
 * Get subscription for a workspace by workspaceId
 * Cached per request for efficiency
 */
export const getSubscriptionByWorkspace = cache(
  async (workspaceId: string): Promise<CatalogSubscription | null> => {
    const catalogDb = getCatalogDb()
    const result = await catalogDb.query.subscription.findFirst({
      where: eq(subscription.workspaceId, workspaceId),
    })

    if (!result) return null

    return {
      id: result.id,
      workspaceId: result.workspaceId,
      stripeCustomerId: result.stripeCustomerId,
      stripeSubscriptionId: result.stripeSubscriptionId,
      tier: result.tier as CloudTier,
      status: result.status as SubscriptionStatus,
      seatsIncluded: result.seatsIncluded,
      seatsAdditional: result.seatsAdditional,
      currentPeriodStart: result.currentPeriodStart,
      currentPeriodEnd: result.currentPeriodEnd,
      cancelAtPeriodEnd: result.cancelAtPeriodEnd ?? false,
      trialStart: result.trialStart,
      trialEnd: result.trialEnd,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    }
  }
)

/**
 * Get subscription by Stripe customer ID
 * Used by webhooks when we have the customer but not workspaceId
 */
export async function getSubscriptionByStripeCustomer(
  stripeCustomerId: string
): Promise<CatalogSubscription | null> {
  const catalogDb = getCatalogDb()
  const result = await catalogDb.query.subscription.findFirst({
    where: eq(subscription.stripeCustomerId, stripeCustomerId),
  })

  if (!result) return null

  return {
    id: result.id,
    workspaceId: result.workspaceId,
    stripeCustomerId: result.stripeCustomerId,
    stripeSubscriptionId: result.stripeSubscriptionId,
    tier: result.tier as CloudTier,
    status: result.status as SubscriptionStatus,
    seatsIncluded: result.seatsIncluded,
    seatsAdditional: result.seatsAdditional,
    currentPeriodStart: result.currentPeriodStart,
    currentPeriodEnd: result.currentPeriodEnd,
    cancelAtPeriodEnd: result.cancelAtPeriodEnd ?? false,
    trialStart: result.trialStart,
    trialEnd: result.trialEnd,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  }
}

/**
 * Create a free subscription for a workspace
 * Used when a workspace is created or when downgrading
 */
export async function createFreeSubscription(
  workspaceId: string,
  stripeCustomerId: string
): Promise<CatalogSubscription> {
  const catalogDb = getCatalogDb()
  const id = `sub_${crypto.randomUUID().replace(/-/g, '')}`
  const now = new Date()

  const [result] = await catalogDb
    .insert(subscription)
    .values({
      id,
      workspaceId,
      stripeCustomerId,
      tier: 'free',
      status: 'active',
      seatsIncluded: 1,
      seatsAdditional: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return {
    id: result.id,
    workspaceId: result.workspaceId,
    stripeCustomerId: result.stripeCustomerId,
    stripeSubscriptionId: result.stripeSubscriptionId,
    tier: result.tier as CloudTier,
    status: result.status as SubscriptionStatus,
    seatsIncluded: result.seatsIncluded,
    seatsAdditional: result.seatsAdditional,
    currentPeriodStart: result.currentPeriodStart,
    currentPeriodEnd: result.currentPeriodEnd,
    cancelAtPeriodEnd: result.cancelAtPeriodEnd ?? false,
    trialStart: result.trialStart,
    trialEnd: result.trialEnd,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  }
}

/**
 * Sync subscription state from Stripe subscription object
 * Called by webhook handlers when subscription changes
 */
export async function syncSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription,
  workspaceId: string
): Promise<CatalogSubscription> {
  const catalogDb = getCatalogDb()

  const customerId =
    typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer.id

  // Determine tier from price ID
  const tier = getTierFromSubscription(stripeSubscription)

  // Map Stripe status to our status
  const status = mapStripeStatus(stripeSubscription.status)

  // Get period from first subscription item
  const firstItem = stripeSubscription.items.data[0]
  const currentPeriodStart = firstItem?.current_period_start
    ? new Date(firstItem.current_period_start * 1000)
    : null
  const currentPeriodEnd = firstItem?.current_period_end
    ? new Date(firstItem.current_period_end * 1000)
    : null

  // Check if subscription exists for this workspace
  const existing = await catalogDb.query.subscription.findFirst({
    where: eq(subscription.workspaceId, workspaceId),
  })

  const values = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: stripeSubscription.id,
    tier,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    trialStart: stripeSubscription.trial_start
      ? new Date(stripeSubscription.trial_start * 1000)
      : null,
    trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
    updatedAt: new Date(),
  }

  let result
  if (existing) {
    // Update existing subscription
    ;[result] = await catalogDb
      .update(subscription)
      .set(values)
      .where(eq(subscription.id, existing.id))
      .returning()
  } else {
    // Create new subscription record
    const id = `sub_${crypto.randomUUID().replace(/-/g, '')}`
    ;[result] = await catalogDb
      .insert(subscription)
      .values({
        id,
        workspaceId,
        seatsIncluded: 1,
        seatsAdditional: 0,
        createdAt: new Date(),
        ...values,
      })
      .returning()
  }

  return {
    id: result.id,
    workspaceId: result.workspaceId,
    stripeCustomerId: result.stripeCustomerId,
    stripeSubscriptionId: result.stripeSubscriptionId,
    tier: result.tier as CloudTier,
    status: result.status as SubscriptionStatus,
    seatsIncluded: result.seatsIncluded,
    seatsAdditional: result.seatsAdditional,
    currentPeriodStart: result.currentPeriodStart,
    currentPeriodEnd: result.currentPeriodEnd,
    cancelAtPeriodEnd: result.cancelAtPeriodEnd ?? false,
    trialStart: result.trialStart,
    trialEnd: result.trialEnd,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  }
}

/**
 * Mark subscription as canceled when deleted in Stripe
 */
export async function markSubscriptionCanceled(stripeCustomerId: string): Promise<void> {
  const catalogDb = getCatalogDb()

  await catalogDb
    .update(subscription)
    .set({
      status: 'canceled',
      stripeSubscriptionId: null,
      updatedAt: new Date(),
    })
    .where(eq(subscription.stripeCustomerId, stripeCustomerId))
}

// ============================================
// Invoice Management
// ============================================

/**
 * Get invoices for a workspace
 */
export async function getInvoicesByWorkspace(
  workspaceId: string,
  limit = 20
): Promise<CatalogInvoice[]> {
  const catalogDb = getCatalogDb()

  const results = await catalogDb.query.invoice.findMany({
    where: eq(invoice.workspaceId, workspaceId),
    orderBy: [desc(invoice.createdAt)],
    limit,
  })

  return results.map((inv) => ({
    id: inv.id,
    workspaceId: inv.workspaceId,
    stripeInvoiceId: inv.stripeInvoiceId,
    amountDue: inv.amountDue,
    amountPaid: inv.amountPaid,
    currency: inv.currency,
    status: inv.status as InvoiceStatus,
    invoiceUrl: inv.invoiceUrl,
    pdfUrl: inv.pdfUrl,
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    createdAt: inv.createdAt,
  }))
}

/**
 * Sync invoice from Stripe
 * Called by webhook handlers when invoice status changes
 */
export async function syncInvoiceFromStripe(
  stripeInvoice: Stripe.Invoice,
  workspaceId: string
): Promise<CatalogInvoice> {
  const catalogDb = getCatalogDb()

  // Check if invoice exists
  const existing = await catalogDb.query.invoice.findFirst({
    where: eq(invoice.stripeInvoiceId, stripeInvoice.id),
  })

  const values = {
    workspaceId,
    amountDue: stripeInvoice.amount_due,
    amountPaid: stripeInvoice.amount_paid,
    currency: stripeInvoice.currency,
    status: mapInvoiceStatus(stripeInvoice.status),
    invoiceUrl: stripeInvoice.hosted_invoice_url,
    pdfUrl: stripeInvoice.invoice_pdf,
    periodStart: stripeInvoice.period_start ? new Date(stripeInvoice.period_start * 1000) : null,
    periodEnd: stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : null,
  }

  let result
  if (existing) {
    ;[result] = await catalogDb
      .update(invoice)
      .set(values)
      .where(eq(invoice.id, existing.id))
      .returning()
  } else {
    const id = `inv_${crypto.randomUUID().replace(/-/g, '')}`
    ;[result] = await catalogDb
      .insert(invoice)
      .values({
        id,
        stripeInvoiceId: stripeInvoice.id,
        createdAt: new Date(),
        ...values,
      })
      .returning()
  }

  return {
    id: result.id,
    workspaceId: result.workspaceId,
    stripeInvoiceId: result.stripeInvoiceId,
    amountDue: result.amountDue,
    amountPaid: result.amountPaid,
    currency: result.currency,
    status: result.status as InvoiceStatus,
    invoiceUrl: result.invoiceUrl,
    pdfUrl: result.pdfUrl,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    createdAt: result.createdAt,
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Determine cloud tier from Stripe subscription
 */
function getTierFromSubscription(stripeSubscription: Stripe.Subscription): CloudTier {
  const priceId = stripeSubscription.items.data[0]?.price.id

  // Check against configured price IDs
  if (priceId === process.env.CLOUD_STRIPE_PRO_PRICE_ID) return 'pro'
  if (priceId === process.env.CLOUD_STRIPE_TEAM_PRICE_ID) return 'team'
  if (priceId === process.env.CLOUD_STRIPE_ENTERPRISE_PRICE_ID) return 'enterprise'

  // Check price metadata as fallback
  const metadata = stripeSubscription.items.data[0]?.price.metadata
  if (metadata?.tier) {
    return metadata.tier as CloudTier
  }

  // Default to pro if we can't determine
  return 'pro'
}

/**
 * Map Stripe subscription status to our status enum
 */
function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'trialing':
      return 'trialing'
    case 'active':
      return 'active'
    case 'past_due':
      return 'past_due'
    case 'canceled':
      return 'canceled'
    case 'unpaid':
      return 'unpaid'
    case 'incomplete':
    case 'incomplete_expired':
      return 'unpaid'
    case 'paused':
      return 'canceled'
    default:
      return 'active'
  }
}

/**
 * Map Stripe invoice status to our status enum
 */
function mapInvoiceStatus(status: Stripe.Invoice.Status | null): InvoiceStatus {
  switch (status) {
    case 'draft':
      return 'draft'
    case 'open':
      return 'open'
    case 'paid':
      return 'paid'
    case 'void':
      return 'void'
    case 'uncollectible':
      return 'uncollectible'
    default:
      return 'draft'
  }
}

/**
 * Check if a subscription is active (can access features)
 */
export function isSubscriptionActive(sub: CatalogSubscription | null): boolean {
  if (!sub) return false
  return sub.status === 'active' || sub.status === 'trialing'
}
