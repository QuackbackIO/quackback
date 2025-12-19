/**
 * SubscriptionService - Business logic for post subscription operations
 *
 * This service handles:
 * - Auto-subscribing users when they interact with posts
 * - Manual subscription management
 * - Querying active subscribers for notifications
 * - Notification preference management
 */

import {
  withTenantContext,
  db,
  eq,
  and,
  postSubscriptions,
  notificationPreferences,
  unsubscribeTokens,
  posts,
  member,
  user,
  type Database,
} from '@quackback/db'
import type { MemberId, PostId, PostSubscriptionId, WorkspaceId } from '@quackback/ids'
import { randomUUID } from 'crypto'

export type SubscriptionReason = 'author' | 'vote' | 'comment' | 'manual'

export interface Subscriber {
  memberId: MemberId
  userId: string
  email: string
  name: string | null
  reason: SubscriptionReason
}

export interface Subscription {
  id: PostSubscriptionId
  postId: PostId
  postTitle: string
  reason: SubscriptionReason
  muted: boolean
  createdAt: Date
}

export interface NotificationPreferencesData {
  emailStatusChange: boolean
  emailNewComment: boolean
  emailMuted: boolean
}

interface SubscribeOptions {
  workspaceId: WorkspaceId
  /** Optional: pass an existing transaction to run within the same context */
  db?: Database
}

/**
 * Service class for subscription domain operations
 */
export class SubscriptionService {
  /**
   * Subscribe a member to a post (idempotent - won't duplicate)
   *
   * @param memberId - The member ID to subscribe
   * @param postId - The post ID to subscribe to
   * @param reason - Why the subscription was created
   * @param options - Organization ID and optional existing database transaction
   */
  async subscribeToPost(
    memberId: MemberId,
    postId: PostId,
    reason: SubscriptionReason,
    options: SubscribeOptions | WorkspaceId
  ): Promise<void> {
    // Support both old signature (WorkspaceId directly) and new signature (options object)
    const { workspaceId, db: existingDb } =
      typeof options === 'string' ? { workspaceId: options as WorkspaceId, db: undefined } : options

    if (existingDb) {
      // Use existing transaction - no need to create new tenant context
      await existingDb
        .insert(postSubscriptions)
        .values({
          postId,
          memberId,
          reason,
        })
        .onConflictDoNothing()
    } else {
      // Create new tenant context
      await withTenantContext(workspaceId, async (txDb) => {
        await txDb
          .insert(postSubscriptions)
          .values({
            postId,
            memberId,
            reason,
          })
          .onConflictDoNothing()
      })
    }
  }

  /**
   * Unsubscribe a member from a post
   */
  async unsubscribeFromPost(
    memberId: MemberId,
    postId: PostId,
    workspaceId: WorkspaceId
  ): Promise<void> {
    await withTenantContext(workspaceId, async (txDb) => {
      await txDb
        .delete(postSubscriptions)
        .where(and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.postId, postId)))
    })
  }

  /**
   * Mute/unmute a subscription (keep it but toggle notifications)
   */
  async setSubscriptionMuted(
    memberId: MemberId,
    postId: PostId,
    muted: boolean,
    workspaceId: WorkspaceId
  ): Promise<void> {
    await withTenantContext(workspaceId, async (txDb) => {
      await txDb
        .update(postSubscriptions)
        .set({ muted, updatedAt: new Date() })
        .where(and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.postId, postId)))
    })
  }

  /**
   * Get subscription status for a member on a post
   * Returns null if not subscribed, or the subscription details
   */
  async getSubscriptionStatus(
    memberId: MemberId,
    postId: PostId,
    workspaceId: WorkspaceId
  ): Promise<{ subscribed: boolean; muted: boolean; reason: SubscriptionReason | null }> {
    return await withTenantContext(workspaceId, async (txDb) => {
      const subscription = await txDb.query.postSubscriptions.findFirst({
        where: and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.postId, postId)),
      })

      if (!subscription) {
        return { subscribed: false, muted: false, reason: null }
      }

      return {
        subscribed: true,
        muted: subscription.muted,
        reason: subscription.reason as SubscriptionReason,
      }
    })
  }

  /**
   * Get all active (non-muted) subscribers for a post
   */
  async getActiveSubscribers(postId: PostId, workspaceId: WorkspaceId): Promise<Subscriber[]> {
    return await withTenantContext(workspaceId, async (txDb) => {
      // Single query with 3-way JOIN to avoid N+1 problem
      const rows = await txDb
        .select({
          memberId: postSubscriptions.memberId,
          reason: postSubscriptions.reason,
          userId: member.userId,
          email: user.email,
          name: user.name,
        })
        .from(postSubscriptions)
        .innerJoin(member, eq(postSubscriptions.memberId, member.id))
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(postSubscriptions.postId, postId), eq(postSubscriptions.muted, false)))

      return rows.map((row) => ({
        memberId: row.memberId,
        userId: row.userId,
        email: row.email,
        name: row.name,
        reason: row.reason as SubscriptionReason,
      }))
    })
  }

  /**
   * Get all subscriptions for a member
   */
  async getMemberSubscriptions(
    memberId: MemberId,
    workspaceId: WorkspaceId
  ): Promise<Subscription[]> {
    return await withTenantContext(workspaceId, async (txDb) => {
      const rows = await txDb
        .select({
          id: postSubscriptions.id,
          postId: postSubscriptions.postId,
          postTitle: posts.title,
          reason: postSubscriptions.reason,
          muted: postSubscriptions.muted,
          createdAt: postSubscriptions.createdAt,
        })
        .from(postSubscriptions)
        .innerJoin(posts, eq(postSubscriptions.postId, posts.id))
        .where(eq(postSubscriptions.memberId, memberId))

      return rows.map((row) => ({
        id: row.id,
        postId: row.postId,
        postTitle: row.postTitle,
        reason: row.reason as SubscriptionReason,
        muted: row.muted,
        createdAt: row.createdAt,
      }))
    })
  }

  /**
   * Get notification preferences for a member (creates defaults if not exists)
   */
  async getNotificationPreferences(
    memberId: MemberId,
    workspaceId: WorkspaceId
  ): Promise<NotificationPreferencesData> {
    return await withTenantContext(workspaceId, async (txDb) => {
      const prefs = await txDb.query.notificationPreferences.findFirst({
        where: eq(notificationPreferences.memberId, memberId),
      })

      if (prefs) {
        return {
          emailStatusChange: prefs.emailStatusChange,
          emailNewComment: prefs.emailNewComment,
          emailMuted: prefs.emailMuted,
        }
      }

      // Return defaults (don't create yet - will create on first update)
      return {
        emailStatusChange: true,
        emailNewComment: true,
        emailMuted: false,
      }
    })
  }

  /**
   * Update notification preferences for a member (upsert)
   */
  async updateNotificationPreferences(
    memberId: MemberId,
    preferences: Partial<NotificationPreferencesData>,
    workspaceId: WorkspaceId
  ): Promise<NotificationPreferencesData> {
    return await withTenantContext(workspaceId, async (txDb) => {
      const existing = await txDb.query.notificationPreferences.findFirst({
        where: eq(notificationPreferences.memberId, memberId),
      })

      if (existing) {
        const [updated] = await txDb
          .update(notificationPreferences)
          .set({
            ...preferences,
            updatedAt: new Date(),
          })
          .where(eq(notificationPreferences.memberId, memberId))
          .returning()

        return {
          emailStatusChange: updated.emailStatusChange,
          emailNewComment: updated.emailNewComment,
          emailMuted: updated.emailMuted,
        }
      } else {
        const [created] = await txDb
          .insert(notificationPreferences)
          .values({
            memberId,
            emailStatusChange: preferences.emailStatusChange ?? true,
            emailNewComment: preferences.emailNewComment ?? true,
            emailMuted: preferences.emailMuted ?? false,
          })
          .returning()

        return {
          emailStatusChange: created.emailStatusChange,
          emailNewComment: created.emailNewComment,
          emailMuted: created.emailMuted,
        }
      }
    })
  }

  /**
   * Generate an unsubscribe token for email links
   */
  async generateUnsubscribeToken(
    memberId: MemberId,
    postId: PostId | null,
    action: 'unsubscribe_post' | 'unsubscribe_all' | 'mute_post'
  ): Promise<string> {
    const token = randomUUID()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    // Use db directly (no tenant context needed for tokens)
    await db.insert(unsubscribeTokens).values({
      token,
      memberId,
      postId,
      action,
      expiresAt,
    })

    return token
  }

  /**
   * Process an unsubscribe token
   * Returns the action performed with post details for redirect, or null if token is invalid/expired
   */
  async processUnsubscribeToken(token: string): Promise<{
    action: string
    memberId: MemberId
    postId: PostId | null
    post?: { title: string; boardSlug: string }
    workspaceId: WorkspaceId
  } | null> {
    // Use db directly (no tenant context needed)
    const tokenRecord = await db.query.unsubscribeTokens.findFirst({
      where: eq(unsubscribeTokens.token, token),
    })

    if (!tokenRecord) {
      return null
    }

    if (tokenRecord.usedAt) {
      return null // Already used
    }

    if (new Date() > tokenRecord.expiresAt) {
      return null // Expired
    }

    // Mark as used
    await db
      .update(unsubscribeTokens)
      .set({ usedAt: new Date() })
      .where(eq(unsubscribeTokens.id, tokenRecord.id))

    // Get member's organization for tenant context
    const memberRecord = await db.query.member.findFirst({
      where: eq(member.id, tokenRecord.memberId),
    })

    if (!memberRecord) {
      return null
    }

    // Get post details if postId exists
    let postDetails: { title: string; boardSlug: string } | undefined
    if (tokenRecord.postId) {
      const post = await db.query.posts.findFirst({
        where: eq(posts.id, tokenRecord.postId),
        columns: { title: true },
        with: { board: { columns: { slug: true } } },
      })
      if (post) {
        postDetails = { title: post.title, boardSlug: post.board.slug }
      }
    }

    // Perform the action
    switch (tokenRecord.action) {
      case 'unsubscribe_post':
        if (tokenRecord.postId) {
          await this.unsubscribeFromPost(
            tokenRecord.memberId,
            tokenRecord.postId,
            memberRecord.workspaceId
          )
        }
        break
      case 'mute_post':
        if (tokenRecord.postId) {
          await this.setSubscriptionMuted(
            tokenRecord.memberId,
            tokenRecord.postId,
            true,
            memberRecord.workspaceId
          )
        }
        break
      case 'unsubscribe_all':
        await this.updateNotificationPreferences(
          tokenRecord.memberId,
          { emailMuted: true },
          memberRecord.workspaceId
        )
        break
    }

    return {
      action: tokenRecord.action,
      memberId: tokenRecord.memberId,
      postId: tokenRecord.postId,
      post: postDetails,
      workspaceId: memberRecord.workspaceId,
    }
  }
}
