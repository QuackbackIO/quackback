import Stripe from 'stripe'
import type { PricingTier } from '@quackback/domain/features'

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
 * Map pricing tiers to Stripe price IDs from environment variables.
 */
export function getTierPriceIds(): Record<Exclude<PricingTier, 'enterprise'>, string | undefined> {
  return {
    essentials: process.env.STRIPE_PRICE_ESSENTIALS,
    professional: process.env.STRIPE_PRICE_PROFESSIONAL,
    team: process.env.STRIPE_PRICE_TEAM,
  }
}

/**
 * Reverse mapping: Stripe price ID to pricing tier.
 */
export function getTierFromPriceId(priceId: string): PricingTier | null {
  const priceIds = getTierPriceIds()
  for (const [tier, id] of Object.entries(priceIds)) {
    if (id === priceId) {
      return tier as PricingTier
    }
  }
  return null
}

/**
 * Get price ID for a tier.
 */
export function getPriceIdForTier(tier: PricingTier): string | null {
  if (tier === 'enterprise') {
    return null // Enterprise is custom pricing
  }
  const priceIds = getTierPriceIds()
  return priceIds[tier] ?? null
}

// ============================================================================
// Types
// ============================================================================

export interface CreateCheckoutSessionParams {
  organizationId: string
  organizationName: string
  tier: Exclude<PricingTier, 'enterprise'>
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
  organizationId,
  organizationName,
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
        organizationId,
        organizationName,
        tier,
      },
      trial_period_days: trialDays,
    },
    metadata: {
      organizationId,
      tier,
    },
    allow_promotion_codes: true,
  }

  // Use existing customer or create new one
  if (existingCustomerId) {
    sessionParams.customer = existingCustomerId
  } else {
    sessionParams.customer_email = customerEmail
    sessionParams.customer_creation = 'always'
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
