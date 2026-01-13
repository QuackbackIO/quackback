/**
 * Stripe subscription service
 *
 * Handles all subscription-related operations including:
 * - Customer creation and management
 * - Checkout session creation for upgrades
 * - Customer portal session creation
 * - Subscription syncing from Stripe webhooks
 */
import type Stripe from 'stripe'
import { cache } from 'react'
import { db, billingSubscriptions, invoices, eq } from '@/lib/db'
import { getStripe } from './client'
import { getTierPriceId } from './prices'
import { createId } from '@quackback/ids'
import type { CloudTier } from '@/lib/features'
import type { Subscription, Invoice, NewSubscription, NewInvoice } from '@quackback/db/types'

// ============================================
// Types
// ============================================

export interface CreateCheckoutOptions {
  customerId: string
  tier: Exclude<CloudTier, 'free'>
  successUrl: string
  cancelUrl: string
  trialDays?: number
}

export interface UpcomingInvoicePreview {
  amountDue: number
  currency: string
  periodStart: Date | null
  periodEnd: Date | null
  lines: {
    description: string | null
    amount: number
  }[]
}

// ============================================
// Customer Management
// ============================================

/**
 * Create a Stripe customer for a workspace
 */
export async function createStripeCustomer(
  email: string,
  workspaceName: string,
  metadata?: Record<string, string>
): Promise<Stripe.Customer> {
  const stripe = getStripe()

  const customer = await stripe.customers.create({
    email,
    name: workspaceName,
    metadata: {
      source: 'quackback',
      ...metadata,
    },
  })

  return customer
}

/**
 * Get or create Stripe customer for a workspace
 */
export async function getOrCreateStripeCustomer(
  email: string,
  workspaceName: string,
  existingCustomerId?: string | null
): Promise<Stripe.Customer> {
  const stripe = getStripe()

  // If we have an existing customer ID, verify it still exists
  if (existingCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(existingCustomerId)
      if (!customer.deleted) {
        return customer as Stripe.Customer
      }
    } catch {
      // Customer doesn't exist, create a new one
    }
  }

  // Create new customer
  return createStripeCustomer(email, workspaceName)
}

// ============================================
// Checkout Sessions
// ============================================

/**
 * Create a Stripe Checkout session for upgrading to a paid tier
 */
export async function createCheckoutSession(
  options: CreateCheckoutOptions
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe()
  const priceId = getTierPriceId(options.tier)

  if (!priceId) {
    throw new Error(`Price ID not configured for tier: ${options.tier}`)
  }

  const sessionConfig: Stripe.Checkout.SessionCreateParams = {
    customer: options.customerId,
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    subscription_data: options.trialDays
      ? {
          trial_period_days: options.trialDays,
        }
      : undefined,
    billing_address_collection: 'auto',
    tax_id_collection: {
      enabled: true,
    },
  }

  return stripe.checkout.sessions.create(sessionConfig)
}

// ============================================
// Customer Portal
// ============================================

/**
 * Create a Stripe Customer Portal session
 * Allows customers to manage their subscription, payment methods, and invoices
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe()

  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
}

// ============================================
// Subscription Management
// ============================================

/**
 * Get subscription for the current workspace
 * Cached per request
 */
export const getSubscription = cache(async (): Promise<Subscription | null> => {
  const result = await db.query.billingSubscriptions.findFirst()
  return result || null
})

/**
 * Create initial subscription record (Free tier)
 */
export async function createFreeSubscription(stripeCustomerId: string): Promise<Subscription> {
  const id = createId('subscription')

  const [subscription] = await db
    .insert(billingSubscriptions)
    .values({
      id,
      stripeCustomerId,
      tier: 'free',
      status: 'active',
      seatsIncluded: 1,
      seatsAdditional: 0,
    })
    .returning()

  return subscription
}

/**
 * Sync subscription state from Stripe subscription object
 * Called by webhook handlers when subscription changes
 */
export async function syncSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription
): Promise<Subscription> {
  const customerId =
    typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer.id

  // Determine tier from price ID
  const tier = getTierFromSubscription(stripeSubscription)

  // Map Stripe status to our status
  const status = mapStripeStatus(stripeSubscription.status)

  // Check if subscription exists
  const existing = await db.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.stripeCustomerId, customerId),
  })

  // Get period from first subscription item (new Stripe API structure)
  const firstItem = stripeSubscription.items.data[0]
  const currentPeriodStart = firstItem?.current_period_start
    ? new Date(firstItem.current_period_start * 1000)
    : null
  const currentPeriodEnd = firstItem?.current_period_end
    ? new Date(firstItem.current_period_end * 1000)
    : null

  const values: Partial<NewSubscription> = {
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
  }

  if (existing) {
    // Update existing subscription
    const [updated] = await db
      .update(billingSubscriptions)
      .set(values)
      .where(eq(billingSubscriptions.id, existing.id))
      .returning()

    return updated
  } else {
    // Create new subscription record
    const [created] = await db
      .insert(billingSubscriptions)
      .values({
        id: createId('subscription'),
        stripeCustomerId: customerId,
        ...values,
      } as NewSubscription)
      .returning()

    return created
  }
}

/**
 * Mark subscription as canceled
 */
export async function markSubscriptionCanceled(stripeCustomerId: string): Promise<void> {
  await db
    .update(billingSubscriptions)
    .set({
      status: 'canceled',
      stripeSubscriptionId: null,
    })
    .where(eq(billingSubscriptions.stripeCustomerId, stripeCustomerId))
}

// ============================================
// Invoice Management
// ============================================

/**
 * Get invoices for the current workspace
 */
export async function getInvoices(limit = 10): Promise<Invoice[]> {
  const subscription = await getSubscription()
  if (!subscription) return []

  // Note: In multi-tenant, invoices would be filtered by workspace
  // For now, return all invoices (single tenant per DB)
  return db.query.invoices.findMany({
    orderBy: (invoices, { desc }) => [desc(invoices.createdAt)],
    limit,
  })
}

/**
 * Sync invoice from Stripe
 * Called by webhook handlers when invoice status changes
 */
export async function syncInvoiceFromStripe(stripeInvoice: Stripe.Invoice): Promise<Invoice> {
  // Check if invoice exists
  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.stripeInvoiceId, stripeInvoice.id),
  })

  const values: Partial<NewInvoice> = {
    amountDue: stripeInvoice.amount_due,
    amountPaid: stripeInvoice.amount_paid,
    currency: stripeInvoice.currency,
    status: mapInvoiceStatus(stripeInvoice.status),
    invoiceUrl: stripeInvoice.hosted_invoice_url,
    pdfUrl: stripeInvoice.invoice_pdf,
    periodStart: stripeInvoice.period_start ? new Date(stripeInvoice.period_start * 1000) : null,
    periodEnd: stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : null,
  }

  if (existing) {
    const [updated] = await db
      .update(invoices)
      .set(values)
      .where(eq(invoices.id, existing.id))
      .returning()

    return updated
  } else {
    const [created] = await db
      .insert(invoices)
      .values({
        id: createId('invoice'),
        stripeInvoiceId: stripeInvoice.id,
        ...values,
      } as NewInvoice)
      .returning()

    return created
  }
}

/**
 * Get upcoming invoice preview from Stripe
 */
export async function getUpcomingInvoice(
  customerId: string
): Promise<UpcomingInvoicePreview | null> {
  const stripe = getStripe()

  try {
    const invoice = await stripe.invoices.createPreview({
      customer: customerId,
    })

    return {
      amountDue: invoice.amount_due,
      currency: invoice.currency,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
      lines: invoice.lines.data.map((line: { description: string | null; amount: number }) => ({
        description: line.description,
        amount: line.amount,
      })),
    }
  } catch {
    // No upcoming invoice (e.g., free tier)
    return null
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Determine cloud tier from Stripe subscription
 */
function getTierFromSubscription(subscription: Stripe.Subscription): CloudTier {
  const priceId = subscription.items.data[0]?.price.id

  // Check against configured price IDs
  if (priceId === process.env.CLOUD_STRIPE_PRO_PRICE_ID) return 'pro'
  if (priceId === process.env.CLOUD_STRIPE_TEAM_PRICE_ID) return 'team'
  if (priceId === process.env.CLOUD_STRIPE_ENTERPRISE_PRICE_ID) return 'enterprise'

  // Check price metadata as fallback
  const metadata = subscription.items.data[0]?.price.metadata
  if (metadata?.tier) {
    return metadata.tier as CloudTier
  }

  // Default to pro if we can't determine
  return 'pro'
}

/**
 * Map Stripe subscription status to our status enum
 */
function mapStripeStatus(
  status: Stripe.Subscription.Status
): 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' {
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
function mapInvoiceStatus(
  status: Stripe.Invoice.Status | null
): 'draft' | 'open' | 'paid' | 'void' | 'uncollectible' {
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
