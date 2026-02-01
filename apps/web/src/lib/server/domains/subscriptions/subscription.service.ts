/**
 * Subscription Service - Business logic for post subscription operations
 *
 * This service handles:
 * - Auto-subscribing users when they interact with posts
 * - Manual subscription management
 * - Querying subscribers for notifications
 * - Notification preference management
 *
 * Subscription model:
 * - notifyComments: receive notifications when someone comments
 * - notifyStatusChanges: receive notifications when status changes
 *
 * "All activity" = both true
 * "Status changes only" = notifyComments=false, notifyStatusChanges=true
 * "Unsubscribed" = row deleted
 */

import {
  db,
  eq,
  and,
  inArray,
  postSubscriptions,
  notificationPreferences,
  unsubscribeTokens,
  posts,
  member,
  user,
  type Transaction,
} from '@/lib/db'
import type { MemberId, PostId } from '@quackback/ids'
import { randomUUID } from 'crypto'
import type {
  SubscriptionReason,
  Subscriber,
  Subscription,
  NotificationPreferencesData,
  SubscriptionLevel,
} from './subscription.types'

// Re-export types for backwards compatibility
export type {
  SubscriptionReason,
  Subscriber,
  Subscription,
  NotificationPreferencesData,
  SubscriptionLevel,
} from './subscription.types'

interface SubscribeOptions {
  /** Pass an existing transaction to run within the same context */
  tx?: Transaction
  /** Notification level - defaults to 'all' */
  level?: SubscriptionLevel
}

/**
 * Subscribe a member to a post (idempotent - won't duplicate)
 *
 * @param memberId - The member ID to subscribe
 * @param postId - The post ID to subscribe to
 * @param reason - Why the subscription was created
 * @param options - Optional existing database transaction and notification level
 */
export async function subscribeToPost(
  memberId: MemberId,
  postId: PostId,
  reason: SubscriptionReason,
  options?: SubscribeOptions
): Promise<void> {
  const executor = options?.tx ?? db
  const level = options?.level ?? 'all'

  const notifyComments = level === 'all'
  const notifyStatusChanges = level === 'all' || level === 'status_only'

  await executor
    .insert(postSubscriptions)
    .values({
      postId,
      memberId,
      reason,
      notifyComments,
      notifyStatusChanges,
    })
    .onConflictDoNothing()
}

/**
 * Unsubscribe a member from a post
 */
export async function unsubscribeFromPost(memberId: MemberId, postId: PostId): Promise<void> {
  await db
    .delete(postSubscriptions)
    .where(and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.postId, postId)))
}

/**
 * Update subscription notification level
 */
export async function updateSubscriptionLevel(
  memberId: MemberId,
  postId: PostId,
  level: SubscriptionLevel
): Promise<void> {
  if (level === 'none') {
    await unsubscribeFromPost(memberId, postId)
    return
  }

  const notifyComments = level === 'all'
  const notifyStatusChanges = true // Both 'all' and 'status_only' get status changes

  await db
    .update(postSubscriptions)
    .set({
      notifyComments,
      notifyStatusChanges,
      updatedAt: new Date(),
    })
    .where(and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.postId, postId)))
}

/**
 * Get subscription status for a member on a post
 */
export async function getSubscriptionStatus(
  memberId: MemberId,
  postId: PostId
): Promise<{
  subscribed: boolean
  notifyComments: boolean
  notifyStatusChanges: boolean
  reason: SubscriptionReason | null
  level: SubscriptionLevel
}> {
  const subscription = await db.query.postSubscriptions.findFirst({
    where: and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.postId, postId)),
  })

  if (!subscription) {
    return {
      subscribed: false,
      notifyComments: false,
      notifyStatusChanges: false,
      reason: null,
      level: 'none',
    }
  }

  // Determine level from flags
  let level: SubscriptionLevel = 'none'
  if (subscription.notifyComments && subscription.notifyStatusChanges) {
    level = 'all'
  } else if (subscription.notifyStatusChanges) {
    level = 'status_only'
  }

  return {
    subscribed: true,
    notifyComments: subscription.notifyComments,
    notifyStatusChanges: subscription.notifyStatusChanges,
    reason: subscription.reason as SubscriptionReason,
    level,
  }
}

/**
 * Event type for filtering subscribers
 */
export type NotificationEventType = 'comment' | 'status_change'

/**
 * Get subscribers for a post filtered by event type.
 * Returns subscribers who want to be notified about the given event type.
 */
export async function getSubscribersForEvent(
  postId: PostId,
  eventType: NotificationEventType
): Promise<Subscriber[]> {
  // Determine which column to filter by
  const notifyColumn =
    eventType === 'comment'
      ? postSubscriptions.notifyComments
      : postSubscriptions.notifyStatusChanges

  const rows = await db
    .select({
      memberId: postSubscriptions.memberId,
      reason: postSubscriptions.reason,
      notifyComments: postSubscriptions.notifyComments,
      notifyStatusChanges: postSubscriptions.notifyStatusChanges,
      userId: member.userId,
      email: user.email,
      name: user.name,
    })
    .from(postSubscriptions)
    .innerJoin(member, eq(postSubscriptions.memberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(postSubscriptions.postId, postId), eq(notifyColumn, true)))

  return rows.map((row) => ({
    memberId: row.memberId,
    userId: row.userId,
    email: row.email,
    name: row.name,
    reason: row.reason as SubscriptionReason,
    notifyComments: row.notifyComments,
    notifyStatusChanges: row.notifyStatusChanges,
  }))
}

/**
 * Get all subscriptions for a member
 */
export async function getMemberSubscriptions(memberId: MemberId): Promise<Subscription[]> {
  const rows = await db
    .select({
      id: postSubscriptions.id,
      postId: postSubscriptions.postId,
      postTitle: posts.title,
      reason: postSubscriptions.reason,
      notifyComments: postSubscriptions.notifyComments,
      notifyStatusChanges: postSubscriptions.notifyStatusChanges,
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
    notifyComments: row.notifyComments,
    notifyStatusChanges: row.notifyStatusChanges,
    createdAt: row.createdAt,
  }))
}

/**
 * Get notification preferences for a member (creates defaults if not exists)
 */
export async function getNotificationPreferences(
  memberId: MemberId
): Promise<NotificationPreferencesData> {
  const prefs = await db.query.notificationPreferences.findFirst({
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
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPreferencesData = {
  emailStatusChange: true,
  emailNewComment: true,
  emailMuted: false,
}

/**
 * Batch get notification preferences for multiple members.
 * Returns a Map with defaults filled in for members without preferences.
 */
export async function batchGetNotificationPreferences(
  memberIds: MemberId[]
): Promise<Map<MemberId, NotificationPreferencesData>> {
  if (memberIds.length === 0) return new Map()

  const rows = await db
    .select({
      memberId: notificationPreferences.memberId,
      emailStatusChange: notificationPreferences.emailStatusChange,
      emailNewComment: notificationPreferences.emailNewComment,
      emailMuted: notificationPreferences.emailMuted,
    })
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.memberId, memberIds))

  // Build map with found preferences, then fill defaults
  const map = new Map<MemberId, NotificationPreferencesData>(
    rows.map((row) => [
      row.memberId,
      {
        emailStatusChange: row.emailStatusChange,
        emailNewComment: row.emailNewComment,
        emailMuted: row.emailMuted,
      },
    ])
  )

  for (const id of memberIds) {
    if (!map.has(id)) {
      map.set(id, DEFAULT_NOTIFICATION_PREFS)
    }
  }

  return map
}

/**
 * Update notification preferences for a member (upsert)
 */
export async function updateNotificationPreferences(
  memberId: MemberId,
  preferences: Partial<NotificationPreferencesData>
): Promise<NotificationPreferencesData> {
  const existing = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.memberId, memberId),
  })

  if (existing) {
    const [updated] = await db
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
    const [created] = await db
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
}

/**
 * Generate an unsubscribe token for email links
 */
export async function generateUnsubscribeToken(
  memberId: MemberId,
  postId: PostId | null,
  action: 'unsubscribe_post' | 'unsubscribe_all'
): Promise<string> {
  const token = randomUUID()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  await db.insert(unsubscribeTokens).values({
    token,
    memberId,
    postId,
    action,
    expiresAt,
  })

  return token
}

export type UnsubscribeAction = 'unsubscribe_post' | 'unsubscribe_all'

/**
 * Batch generate unsubscribe tokens for multiple members.
 * Returns a Map of memberId -> token.
 */
export async function batchGenerateUnsubscribeTokens(
  entries: Array<{ memberId: MemberId; postId: PostId; action: UnsubscribeAction }>
): Promise<Map<MemberId, string>> {
  if (entries.length === 0) return new Map()

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  const tokens = entries.map((e) => ({
    token: randomUUID(),
    memberId: e.memberId,
    postId: e.postId,
    action: e.action,
    expiresAt,
  }))

  await db.insert(unsubscribeTokens).values(tokens)

  return new Map(tokens.map((t) => [t.memberId, t.token]))
}

/**
 * Process an unsubscribe token
 * Returns the action performed with post details for redirect, or null if token is invalid/expired
 */
export async function processUnsubscribeToken(token: string): Promise<{
  action: string
  memberId: MemberId
  postId: PostId | null
  post?: { title: string; boardSlug: string }
} | null> {
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

  // Get member's organization for workspace context
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
        await unsubscribeFromPost(tokenRecord.memberId, tokenRecord.postId)
      }
      break
    case 'unsubscribe_all':
      await updateNotificationPreferences(tokenRecord.memberId, { emailMuted: true })
      break
  }

  return {
    action: tokenRecord.action,
    memberId: tokenRecord.memberId,
    postId: tokenRecord.postId,
    post: postDetails,
  }
}
