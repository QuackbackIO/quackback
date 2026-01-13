/**
 * Stripe client initialization
 *
 * Provides a singleton Stripe client for server-side operations.
 * Only used in cloud edition for subscription management.
 */
import Stripe from 'stripe'

let stripeClient: Stripe | null = null

/**
 * Get the Stripe client singleton
 * @throws Error if CLOUD_STRIPE_SECRET_KEY is not configured
 */
export function getStripe(): Stripe {
  if (!stripeClient) {
    const secretKey = process.env.CLOUD_STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error('CLOUD_STRIPE_SECRET_KEY environment variable is not configured')
    }

    stripeClient = new Stripe(secretKey, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
    })
  }

  return stripeClient
}

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.CLOUD_STRIPE_SECRET_KEY)
}
