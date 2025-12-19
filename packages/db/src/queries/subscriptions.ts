import { eq } from 'drizzle-orm'
import { db, adminDb } from '../tenant-context'
import { subscription } from '../schema/subscriptions'
import { generateId, type WorkspaceId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'
export type SubscriptionTier = 'essentials' | 'professional' | 'team' | 'enterprise'

export interface CreateSubscriptionData {
  workspaceId: WorkspaceId
  tier: SubscriptionTier
  status?: SubscriptionStatus
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  stripePriceId?: string
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  cancelAtPeriodEnd?: boolean
  canceledAt?: Date | null
  trialStart?: Date
  trialEnd?: Date
}

export interface UpdateSubscriptionData {
  tier?: SubscriptionTier
  status?: SubscriptionStatus
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  stripePriceId?: string
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  cancelAtPeriodEnd?: boolean
  canceledAt?: Date | null
  trialStart?: Date
  trialEnd?: Date
}

// ============================================================================
// Queries (with RLS)
// ============================================================================

/**
 * Get subscription for a workspace (uses RLS)
 */
export async function getSubscriptionByWorkspaceId(workspaceId: WorkspaceId) {
  return db.query.subscription.findFirst({
    where: eq(subscription.workspaceId, workspaceId),
  })
}

// ============================================================================
// Admin Queries (bypass RLS - for webhooks)
// ============================================================================

/**
 * Get subscription by Stripe customer ID (admin - bypasses RLS)
 */
export async function getSubscriptionByStripeCustomerId(stripeCustomerId: string) {
  return adminDb.query.subscription.findFirst({
    where: eq(subscription.stripeCustomerId, stripeCustomerId),
  })
}

/**
 * Get subscription by Stripe subscription ID (admin - bypasses RLS)
 */
export async function getSubscriptionByStripeSubscriptionId(stripeSubscriptionId: string) {
  return adminDb.query.subscription.findFirst({
    where: eq(subscription.stripeSubscriptionId, stripeSubscriptionId),
  })
}

/**
 * Get subscription by workspace ID (admin - bypasses RLS for webhooks)
 */
export async function getSubscriptionByWorkspaceIdAdmin(workspaceId: WorkspaceId) {
  return adminDb.query.subscription.findFirst({
    where: eq(subscription.workspaceId, workspaceId),
  })
}

// ============================================================================
// Mutations (admin - bypasses RLS for webhooks)
// ============================================================================

/**
 * Create a new subscription (admin - bypasses RLS)
 */
export async function createSubscription(data: CreateSubscriptionData) {
  const [result] = await adminDb
    .insert(subscription)
    .values({
      id: generateId('subscription'),
      workspaceId: data.workspaceId,
      tier: data.tier,
      status: data.status ?? 'trialing',
      stripeCustomerId: data.stripeCustomerId,
      stripeSubscriptionId: data.stripeSubscriptionId,
      stripePriceId: data.stripePriceId,
      currentPeriodStart: data.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd,
      trialStart: data.trialStart,
      trialEnd: data.trialEnd,
    })
    .returning()

  return result
}

/**
 * Update a subscription by workspace ID (admin - bypasses RLS)
 */
export async function updateSubscriptionByWorkspaceId(
  workspaceId: WorkspaceId,
  data: UpdateSubscriptionData
) {
  const [result] = await adminDb
    .update(subscription)
    .set(data)
    .where(eq(subscription.workspaceId, workspaceId))
    .returning()

  return result
}

/**
 * Update a subscription by Stripe subscription ID (admin - bypasses RLS)
 */
export async function updateSubscriptionByStripeId(
  stripeSubscriptionId: string,
  data: UpdateSubscriptionData
) {
  const [result] = await adminDb
    .update(subscription)
    .set(data)
    .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
    .returning()

  return result
}

/**
 * Upsert subscription - create or update based on workspace ID (admin - bypasses RLS)
 * Uses onConflictDoUpdate to avoid race conditions with concurrent webhooks.
 */
export async function upsertSubscription(data: CreateSubscriptionData) {
  const [result] = await adminDb
    .insert(subscription)
    .values({
      id: generateId('subscription'),
      workspaceId: data.workspaceId,
      tier: data.tier,
      status: data.status ?? 'trialing',
      stripeCustomerId: data.stripeCustomerId,
      stripeSubscriptionId: data.stripeSubscriptionId,
      stripePriceId: data.stripePriceId,
      currentPeriodStart: data.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
      canceledAt: data.canceledAt,
      trialStart: data.trialStart,
      trialEnd: data.trialEnd,
    })
    .onConflictDoUpdate({
      target: subscription.workspaceId,
      set: {
        tier: data.tier,
        status: data.status ?? 'trialing',
        stripeCustomerId: data.stripeCustomerId,
        stripeSubscriptionId: data.stripeSubscriptionId,
        stripePriceId: data.stripePriceId,
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
        canceledAt: data.canceledAt,
        trialStart: data.trialStart,
        trialEnd: data.trialEnd,
        updatedAt: new Date(),
      },
    })
    .returning()

  return result
}
