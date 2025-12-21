import type { WorkspaceId } from '@quackback/ids'
import { getWorkspaceUsageCounts } from '@quackback/db/queries/usage'
import { getSubscriptionByWorkspaceIdAdmin } from '@quackback/db/queries/subscriptions'
import { updateSubscriptionSeats, isStripeConfigured, type PaidTier } from './stripe'
import { isCloud } from '@quackback/domain/features'

// ============================================================================
// Seat Sync
// ============================================================================

export interface SeatSyncResult {
  success: boolean
  synced: boolean
  error?: string
  seats?: {
    current: number
    included: number
    extra: number
  }
}

/**
 * Sync workspace seat count to Stripe subscription.
 *
 * Call this after any member changes that affect billable seats:
 * - Invitation accepted (with owner/admin role)
 * - Member role changed to/from owner/admin
 * - Member removed (if owner/admin)
 *
 * This function is idempotent - safe to call multiple times.
 * It reads the current seat count from the database and updates Stripe.
 */
export async function syncWorkspaceSeats(workspaceId: WorkspaceId): Promise<SeatSyncResult> {
  // Skip if not cloud edition or Stripe not configured
  if (!isCloud()) {
    return { success: true, synced: false }
  }

  if (!isStripeConfigured()) {
    return { success: true, synced: false }
  }

  try {
    // Get current subscription
    const subscription = await getSubscriptionByWorkspaceIdAdmin(workspaceId)

    if (!subscription || !subscription.stripeSubscriptionId) {
      // No active subscription - nothing to sync
      return { success: true, synced: false }
    }

    // Free tier doesn't have seat billing
    if (subscription.tier === 'free') {
      return { success: true, synced: false }
    }

    const tier = subscription.tier as PaidTier

    // Get current seat count from database
    const usage = await getWorkspaceUsageCounts(workspaceId)
    const currentSeats = usage.seats

    // Sync to Stripe
    await updateSubscriptionSeats(subscription.stripeSubscriptionId, tier, currentSeats)

    // Calculate what was synced for logging
    const { INCLUDED_SEATS } = await import('./stripe')
    const included = INCLUDED_SEATS[tier]
    const extra = Math.max(0, currentSeats - included)

    console.log(
      `Synced seats for workspace ${workspaceId}: ${currentSeats} total (${included} included, ${extra} extra)`
    )

    return {
      success: true,
      synced: true,
      seats: {
        current: currentSeats,
        included,
        extra,
      },
    }
  } catch (error) {
    console.error(`Failed to sync seats for workspace ${workspaceId}:`, error)
    return {
      success: false,
      synced: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Check if a role is billable (counts as a seat).
 */
export function isBillableRole(role: string): boolean {
  return role === 'owner' || role === 'admin'
}
