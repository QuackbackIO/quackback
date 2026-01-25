import { isCloud, type CloudTier } from '@/lib/features'
import { tenantStorage } from '@/lib/tenant/storage'

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'

export interface WorkspaceSubscription {
  tier: CloudTier
  status: SubscriptionStatus
  seatsTotal: number
  currentPeriodEnd: Date | null
}

/**
 * Get subscription for the current workspace from tenant context.
 * Returns null for self-hosted (OSS) editions.
 *
 * Note: Subscription is now populated during tenant resolution to avoid
 * extra catalog DB queries. No longer needs caching as it's read from context.
 */
export function getSubscription(): WorkspaceSubscription | null {
  // OSS edition doesn't use subscriptions
  if (!isCloud()) {
    return null
  }

  // Get subscription from tenant context (populated during resolution)
  const ctx = tenantStorage.getStore()
  const subscription = ctx?.subscription

  if (!subscription) {
    return null
  }

  return {
    tier: subscription.tier,
    status: subscription.status,
    seatsTotal: subscription.seatsTotal,
    currentPeriodEnd: subscription.currentPeriodEnd,
  }
}

/**
 * Check if a subscription is active (can access features)
 */
export function isSubscriptionActive(subscription: WorkspaceSubscription | null): boolean {
  if (!subscription) return false
  return subscription.status === 'active' || subscription.status === 'trialing'
}
