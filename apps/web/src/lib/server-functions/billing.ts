/**
 * Billing server functions
 *
 * Server functions for subscription management, checkout, and billing portal.
 * Only used in cloud edition.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { isCloud } from '@/lib/features'
import {
  getSubscription,
  getInvoices,
  getUpcomingInvoice,
  createCheckoutSession,
  createPortalSession,
  getOrCreateStripeCustomer,
  isStripeConfigured,
} from '@/lib/stripe'
import { db } from '@/lib/db'
import { CLOUD_TIER_CONFIG, type CloudTier } from '@/lib/features'
import type { Subscription, Invoice } from '@quackback/db/types'

// ============================================
// Types
// ============================================

export interface BillingOverview {
  subscription: Subscription | null
  tierConfig: (typeof CLOUD_TIER_CONFIG)[CloudTier] | null
  upcomingInvoice: {
    amountDue: number
    currency: string
    periodEnd: Date | null
  } | null
  isStripeConfigured: boolean
}

export interface InvoiceListItem {
  id: string
  stripeInvoiceId: string
  amountDue: number
  amountPaid: number
  currency: string
  status: Invoice['status']
  invoiceUrl: string | null
  pdfUrl: string | null
  periodStart: Date | null
  periodEnd: Date | null
  createdAt: Date
}

// ============================================
// Read Operations
// ============================================

/**
 * Get billing overview for the current workspace
 */
export const getBillingOverviewFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BillingOverview> => {
    await requireAuth({ roles: ['admin'] })

    // Only available in cloud edition
    if (!isCloud()) {
      return {
        subscription: null,
        tierConfig: null,
        upcomingInvoice: null,
        isStripeConfigured: false,
      }
    }

    const subscription = await getSubscription()
    const tierConfig = subscription ? CLOUD_TIER_CONFIG[subscription.tier] : CLOUD_TIER_CONFIG.free

    // Get upcoming invoice if subscription has Stripe customer
    let upcomingInvoice = null
    if (subscription?.stripeCustomerId && isStripeConfigured()) {
      const upcoming = await getUpcomingInvoice(subscription.stripeCustomerId)
      if (upcoming) {
        upcomingInvoice = {
          amountDue: upcoming.amountDue,
          currency: upcoming.currency,
          periodEnd: upcoming.periodEnd,
        }
      }
    }

    return {
      subscription,
      tierConfig,
      upcomingInvoice,
      isStripeConfigured: isStripeConfigured(),
    }
  }
)

// Schema for getInvoices
const getInvoicesSchema = z.object({ limit: z.number().min(1).max(100).optional() })
type GetInvoicesInput = z.infer<typeof getInvoicesSchema>

/**
 * Get invoice history for the current workspace
 */
export const getInvoicesFn = createServerFn({ method: 'GET' })
  .inputValidator(getInvoicesSchema)
  .handler(async ({ data }: { data: GetInvoicesInput }): Promise<InvoiceListItem[]> => {
    await requireAuth({ roles: ['admin'] })

    if (!isCloud()) {
      return []
    }

    const invoiceList = await getInvoices(data.limit ?? 20)

    return invoiceList.map((inv) => ({
      id: inv.id,
      stripeInvoiceId: inv.stripeInvoiceId,
      amountDue: inv.amountDue,
      amountPaid: inv.amountPaid,
      currency: inv.currency,
      status: inv.status,
      invoiceUrl: inv.invoiceUrl,
      pdfUrl: inv.pdfUrl,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      createdAt: inv.createdAt,
    }))
  })

// ============================================
// Checkout Operations
// ============================================

const createCheckoutSchema = z.object({
  tier: z.enum(['pro', 'team', 'enterprise']),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
})

type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>

/**
 * Create a Stripe Checkout session for upgrading to a paid tier
 */
export const createCheckoutSessionFn = createServerFn({ method: 'POST' })
  .inputValidator(createCheckoutSchema)
  .handler(async ({ data }: { data: CreateCheckoutInput }): Promise<{ url: string }> => {
    const auth = await requireAuth({ roles: ['admin'] })

    if (!isCloud()) {
      throw new Error('Billing is only available in cloud edition')
    }

    if (!isStripeConfigured()) {
      throw new Error('Stripe is not configured')
    }

    // Get or create Stripe customer
    const subscription = await getSubscription()
    const settings = await db.query.settings.findFirst()
    const workspaceName = settings?.name || 'Workspace'

    const customer = await getOrCreateStripeCustomer(
      auth.user.email,
      workspaceName,
      subscription?.stripeCustomerId
    )

    // Build URLs
    const baseUrl = process.env.ROOT_URL || 'http://localhost:3000'
    const successUrl = data.successUrl || `${baseUrl}/admin/settings/billing?success=true`
    const cancelUrl = data.cancelUrl || `${baseUrl}/admin/settings/billing?canceled=true`

    // Create checkout session
    const session = await createCheckoutSession({
      customerId: customer.id,
      tier: data.tier,
      successUrl,
      cancelUrl,
      trialDays: subscription?.tier === 'free' ? 14 : undefined, // 14-day trial for new upgrades
    })

    if (!session.url) {
      throw new Error('Failed to create checkout session')
    }

    return { url: session.url }
  })

// ============================================
// Portal Operations
// ============================================

// Schema for portal session
const createPortalSchema = z.object({ returnUrl: z.string().url().optional() })
type CreatePortalInput = z.infer<typeof createPortalSchema>

/**
 * Create a Stripe Customer Portal session
 */
export const createPortalSessionFn = createServerFn({ method: 'POST' })
  .inputValidator(createPortalSchema)
  .handler(async ({ data }: { data: CreatePortalInput }): Promise<{ url: string }> => {
    await requireAuth({ roles: ['admin'] })

    if (!isCloud()) {
      throw new Error('Billing is only available in cloud edition')
    }

    if (!isStripeConfigured()) {
      throw new Error('Stripe is not configured')
    }

    const subscription = await getSubscription()

    if (!subscription?.stripeCustomerId) {
      throw new Error('No billing account found')
    }

    const baseUrl = process.env.ROOT_URL || 'http://localhost:3000'
    const returnUrl = data.returnUrl || `${baseUrl}/admin/settings/billing`

    const session = await createPortalSession(subscription.stripeCustomerId, returnUrl)

    return { url: session.url }
  })
