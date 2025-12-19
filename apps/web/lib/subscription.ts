import { cache } from 'react'
import { getSubscriptionByWorkspaceId } from '@/lib/db'
import { isCloud, type PricingTier } from '@quackback/domain'
import type { WorkspaceId, SubscriptionId } from '@quackback/ids'

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'

export interface WorkspaceSubscription {
  id: SubscriptionId
  workspaceId: WorkspaceId
  tier: PricingTier
  status: SubscriptionStatus
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  trialEnd: Date | null
}

/**
 * Get subscription for an organization.
 * Returns null for self-hosted (OSS) editions.
 * Cached per request.
 */
export const getSubscription = cache(
  async (workspaceId: WorkspaceId): Promise<WorkspaceSubscription | null> => {
    // OSS edition doesn't use subscriptions
    if (!isCloud()) {
      return null
    }

    const row = await getSubscriptionByWorkspaceId(workspaceId)
    if (!row) return null

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      tier: row.tier as PricingTier,
      status: row.status as SubscriptionStatus,
      stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      trialEnd: row.trialEnd,
    }
  }
)

/**
 * Check if a subscription is active (can access features)
 */
export function isSubscriptionActive(subscription: WorkspaceSubscription | null): boolean {
  if (!subscription) return false
  return subscription.status === 'active' || subscription.status === 'trialing'
}
