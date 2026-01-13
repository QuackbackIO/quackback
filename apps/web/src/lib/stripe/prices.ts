/**
 * Stripe price ID configuration
 *
 * Maps cloud tiers to Stripe price IDs configured via environment variables.
 * These IDs should be created in the Stripe Dashboard.
 */
import type { CloudTier } from '@/lib/features'

/**
 * Get the Stripe price ID for a cloud tier
 * @returns The price ID or null if not configured
 */
export function getTierPriceId(tier: CloudTier): string | null {
  switch (tier) {
    case 'free':
      return null // Free tier has no Stripe price
    case 'pro':
      return process.env.CLOUD_STRIPE_PRO_PRICE_ID || null
    case 'team':
      return process.env.CLOUD_STRIPE_TEAM_PRICE_ID || null
    case 'enterprise':
      return process.env.CLOUD_STRIPE_ENTERPRISE_PRICE_ID || null
    default:
      return null
  }
}

/**
 * Get the Stripe price ID for additional seats on a tier
 * @returns The seat addon price ID or null if not configured
 */
export function getSeatPriceId(tier: CloudTier): string | null {
  switch (tier) {
    case 'free':
      return null // Free tier doesn't support additional seats
    case 'pro':
      return process.env.CLOUD_STRIPE_SEAT_PRO_PRICE_ID || null
    case 'team':
      return process.env.CLOUD_STRIPE_SEAT_TEAM_PRICE_ID || null
    case 'enterprise':
      return process.env.CLOUD_STRIPE_SEAT_ENTERPRISE_PRICE_ID || null
    default:
      return null
  }
}

/**
 * Get all configured price IDs for validation
 */
export function getConfiguredPrices(): {
  tiers: Record<Exclude<CloudTier, 'free'>, string | null>
  seats: Record<Exclude<CloudTier, 'free'>, string | null>
} {
  return {
    tiers: {
      pro: process.env.CLOUD_STRIPE_PRO_PRICE_ID || null,
      team: process.env.CLOUD_STRIPE_TEAM_PRICE_ID || null,
      enterprise: process.env.CLOUD_STRIPE_ENTERPRISE_PRICE_ID || null,
    },
    seats: {
      pro: process.env.CLOUD_STRIPE_SEAT_PRO_PRICE_ID || null,
      team: process.env.CLOUD_STRIPE_SEAT_TEAM_PRICE_ID || null,
      enterprise: process.env.CLOUD_STRIPE_SEAT_ENTERPRISE_PRICE_ID || null,
    },
  }
}

/**
 * Check if price IDs are properly configured
 */
export function arePricesConfigured(): boolean {
  return Boolean(
    process.env.CLOUD_STRIPE_PRO_PRICE_ID &&
    process.env.CLOUD_STRIPE_TEAM_PRICE_ID &&
    process.env.CLOUD_STRIPE_ENTERPRISE_PRICE_ID
  )
}
