import { cache } from 'react'
import { isCloud, type CloudTier } from '@/lib/features'
import { tenantStorage } from '@/lib/tenant/storage'
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
 * Get subscription for the current workspace.
 * Returns null for self-hosted (OSS) editions.
 * Cached per request.
 */
export const getSubscription = cache(async (): Promise<WorkspaceSubscription | null> => {
  // OSS edition doesn't use subscriptions
  if (!isCloud()) {
    return null
  }

  // Get workspaceId from tenant context
  const ctx = tenantStorage.getStore()
  const workspaceId = ctx?.workspaceId
  if (!workspaceId || workspaceId === 'self-hosted' || workspaceId === 'unknown') {
    return null
  }

  // Import catalog billing service dynamically to avoid loading in self-hosted
  const { getSubscriptionByWorkspace } = await import('@/lib/stripe/catalog-billing.service')

  const subscription = await getSubscriptionByWorkspace(workspaceId)

  if (!subscription) {
    return null
  }

  return {
    id: subscription.id as SubscriptionId,
    tier: subscription.tier,
    status: subscription.status,
    stripeCustomerId: subscription.stripeCustomerId,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    trialEnd: subscription.trialEnd,
  }
})

/**
 * Check if a subscription is active (can access features)
 */
export function isSubscriptionActive(subscription: WorkspaceSubscription | null): boolean {
  if (!subscription) return false
  return subscription.status === 'active' || subscription.status === 'trialing'
}
