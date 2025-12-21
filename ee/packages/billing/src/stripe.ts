import Stripe from 'stripe'
import type { PricingTier } from '@quackback/domain/features'
import type { WorkspaceId } from '@quackback/ids'

// ============================================================================
// Stripe Client
// ============================================================================

let stripeInstance: Stripe | null = null

/**
 * Get Stripe client instance (singleton). Throws if not configured.
 */
export function getStripe(): Stripe {
  if (stripeInstance) {
    return stripeInstance
  }

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }

  stripeInstance = new Stripe(secretKey, {
    apiVersion: '2025-11-17.clover',
    typescript: true,
  })

  return stripeInstance
}

/**
 * Check if Stripe is configured.
 */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

// ============================================================================
// Price Configuration
// ============================================================================

/**
 * Paid tiers that have Stripe prices (excludes free)
 */
export type PaidTier = 'pro' | 'team' | 'enterprise'

/**
 * Map pricing tiers to base subscription Stripe price IDs.
 */
export function getTierPriceIds(): Record<PaidTier, string | undefined> {
  return {
    pro: process.env.STRIPE_PRICE_PRO,
    team: process.env.STRIPE_PRICE_TEAM,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  }
}

/**
 * Map pricing tiers to per-seat add-on Stripe price IDs.
 */
export function getSeatPriceIds(): Record<PaidTier, string | undefined> {
  return {
    pro: process.env.STRIPE_PRICE_PRO_SEAT,
    team: process.env.STRIPE_PRICE_TEAM_SEAT,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE_SEAT,
  }
}

/**
 * Included seats per tier (seats included in base price).
 */
export const INCLUDED_SEATS: Record<PaidTier, number> = {
  pro: 2,
  team: 5,
  enterprise: 10,
}

/**
 * Reverse mapping: Stripe price ID to pricing tier.
 * Checks both base and seat price IDs.
 */
export function getTierFromPriceId(priceId: string): PricingTier | null {
  const basePriceIds = getTierPriceIds()
  for (const [tier, id] of Object.entries(basePriceIds)) {
    if (id === priceId) {
      return tier as PricingTier
    }
  }
  // Also check seat prices
  const seatPriceIds = getSeatPriceIds()
  for (const [tier, id] of Object.entries(seatPriceIds)) {
    if (id === priceId) {
      return tier as PricingTier
    }
  }
  return null
}

/**
 * Get base price ID for a tier.
 */
export function getPriceIdForTier(tier: PricingTier): string | null {
  if (tier === 'free') {
    return null // Free is $0
  }
  const priceIds = getTierPriceIds()
  return priceIds[tier] ?? null
}

/**
 * Get seat price ID for a tier.
 */
export function getSeatPriceIdForTier(tier: PricingTier): string | null {
  if (tier === 'free') {
    return null
  }
  const seatPriceIds = getSeatPriceIds()
  return seatPriceIds[tier] ?? null
}

// ============================================================================
// Types
// ============================================================================

export interface CreateCheckoutSessionParams {
  workspaceId: WorkspaceId
  workspaceName: string
  tier: PaidTier
  customerEmail: string
  existingCustomerId?: string
  successUrl: string
  cancelUrl: string
  trialDays?: number
}

export interface CreatePortalSessionParams {
  customerId: string
  returnUrl: string
}

// ============================================================================
// Checkout Session
// ============================================================================

/**
 * Create a Stripe Checkout session for a new subscription.
 */
export async function createCheckoutSession({
  workspaceId,
  workspaceName,
  tier,
  customerEmail,
  existingCustomerId,
  successUrl,
  cancelUrl,
  trialDays = 14,
}: CreateCheckoutSessionParams): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe()
  const priceId = getPriceIdForTier(tier)

  if (!priceId) {
    throw new Error(`No price ID configured for tier: ${tier}`)
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: {
        workspaceId,
        workspaceName,
        tier,
      },
      trial_period_days: trialDays,
    },
    metadata: {
      workspaceId,
      tier,
    },
    allow_promotion_codes: true,
  }

  // Use existing customer or create new one
  if (existingCustomerId) {
    sessionParams.customer = existingCustomerId
  } else {
    sessionParams.customer_email = customerEmail
    // Note: customer_creation is not valid in subscription mode
    // Stripe automatically creates a customer when customer_email is provided
  }

  return stripe.checkout.sessions.create(sessionParams)
}

// ============================================================================
// Customer Portal
// ============================================================================

/**
 * Create a Stripe Customer Portal session for managing subscriptions.
 */
export async function createPortalSession({
  customerId,
  returnUrl,
}: CreatePortalSessionParams): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe()

  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
}

// ============================================================================
// Subscription Management
// ============================================================================

/**
 * Get subscription details from Stripe.
 */
export async function getStripeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  return stripe.subscriptions.retrieve(subscriptionId)
}

/**
 * Cancel a subscription at period end.
 */
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  })
}

/**
 * Reactivate a subscription that was set to cancel.
 */
export async function reactivateSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  })
}

// ============================================================================
// Seat Management
// ============================================================================

/**
 * Calculate how many additional seats need to be billed.
 * Returns 0 if seats are within the included limit.
 */
export function calculateExtraSeats(tier: PaidTier, totalSeats: number): number {
  const included = INCLUDED_SEATS[tier]
  return Math.max(0, totalSeats - included)
}

/**
 * Update the seat quantity on a subscription.
 * Adds or updates the seat line item based on current seat count.
 */
export async function updateSubscriptionSeats(
  subscriptionId: string,
  tier: PaidTier,
  totalSeats: number
): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  const extraSeats = calculateExtraSeats(tier, totalSeats)
  const seatPriceId = getSeatPriceIdForTier(tier)

  if (!seatPriceId) {
    throw new Error(`No seat price configured for tier: ${tier}`)
  }

  // Get current subscription to find seat line item
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const seatItem = subscription.items.data.find((item) => item.price.id === seatPriceId)

  if (extraSeats === 0) {
    // No extra seats needed - remove seat line item if it exists
    if (seatItem) {
      return stripe.subscriptions.update(subscriptionId, {
        items: [{ id: seatItem.id, deleted: true }],
        proration_behavior: 'create_prorations',
      })
    }
    return subscription
  }

  if (seatItem) {
    // Update existing seat line item quantity
    return stripe.subscriptions.update(subscriptionId, {
      items: [{ id: seatItem.id, quantity: extraSeats }],
      proration_behavior: 'create_prorations',
    })
  }

  // Add new seat line item
  return stripe.subscriptions.update(subscriptionId, {
    items: [{ price: seatPriceId, quantity: extraSeats }],
    proration_behavior: 'create_prorations',
  })
}

/**
 * Get the current seat count from a subscription.
 * Returns { included, extra, total }.
 */
export async function getSubscriptionSeatInfo(
  subscriptionId: string,
  tier: PaidTier
): Promise<{ included: number; extra: number; total: number }> {
  const stripe = getStripe()
  const seatPriceId = getSeatPriceIdForTier(tier)
  const included = INCLUDED_SEATS[tier]

  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const seatItem = subscription.items.data.find((item) => item.price.id === seatPriceId)

  const extra = seatItem?.quantity ?? 0
  return {
    included,
    extra,
    total: included + extra,
  }
}

// ============================================================================
// Webhook Verification
// ============================================================================

/**
 * Verify and construct a Stripe webhook event.
 */
export function constructWebhookEvent(payload: string, signature: string): Stripe.Event {
  const stripe = getStripe()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
  }

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret)
}

// Re-export Stripe types that may be useful
export type { Stripe }
