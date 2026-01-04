import { cache } from 'react'
import { isCloud, type CloudTier } from '@/lib/features'
import type { SubscriptionId } from '@quackback/ids'

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'

export interface WorkspaceSubscription {
  id: SubscriptionId
  tier: CloudTier
  status: SubscriptionStatus
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  trialEnd: Date | null
}

/**
 * Get subscription for the application (single workspace).
 * Returns null for self-hosted (OSS) editions.
 * Cached per request.
 */
export const getSubscription = cache(async (): Promise<WorkspaceSubscription | null> => {
  // OSS edition doesn't use subscriptions
  if (!isCloud()) {
    return null
  }

  // Cloud subscriptions would be handled by EE package
  // For now, return null as we don't have subscription table in OSS
  return null
})

/**
 * Check if a subscription is active (can access features)
 */
export function isSubscriptionActive(subscription: WorkspaceSubscription | null): boolean {
  if (!subscription) return false
  return subscription.status === 'active' || subscription.status === 'trialing'
}
