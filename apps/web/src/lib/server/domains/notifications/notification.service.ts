/**
 * Notification Service - Business logic for in-app notification operations
 *
 * This service handles:
 * - Creating notifications (batch insert for efficiency)
 * - Querying notifications with pagination
 * - Marking notifications as read (single and bulk)
 * - Archiving (soft delete) notifications
 */

import {
  db,
  eq,
  and,
  desc,
  isNull,
  sql,
  inAppNotifications,
  posts,
  boards,
  type Transaction,
} from '@/lib/server/db'
import type { NotificationId, MemberId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import type {
  CreateNotificationInput,
  NotificationType,
  NotificationWithPost,
  NotificationListResult,
  GetNotificationsOptions,
} from './notification.types'

/**
 * Create notifications in batch (single INSERT for efficiency)
 * Used when dispatching notifications to multiple subscribers
 */
export async function createNotificationsBatch(
  inputs: CreateNotificationInput[],
  tx?: Transaction
): Promise<NotificationId[]> {
  if (inputs.length === 0) return []

  const executor = tx ?? db

  const rows = await executor
    .insert(inAppNotifications)
    .values(
      inputs.map((input) => ({
        id: createId('notification'),
        memberId: input.memberId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        postId: input.postId ?? null,
        commentId: input.commentId ?? null,
        metadata: input.metadata ?? null,
      }))
    )
    .returning()

  return rows.map((r) => r.id)
}

/**
 * Create a single notification
 */
export async function createNotification(
  input: CreateNotificationInput,
  tx?: Transaction
): Promise<NotificationId> {
  const [id] = await createNotificationsBatch([input], tx)
  return id
}

/**
 * Get notifications for a member with pagination
 */
export async function getNotificationsForMember(
  memberId: MemberId,
  options: GetNotificationsOptions = {}
): Promise<NotificationListResult> {
  const { limit = 20, offset = 0, unreadOnly = false } = options

  // Build where clause
  const baseWhere = and(
    eq(inAppNotifications.memberId, memberId),
    isNull(inAppNotifications.archivedAt)
  )

  const where = unreadOnly ? and(baseWhere, isNull(inAppNotifications.readAt)) : baseWhere

  // Get notifications with post details
  const rows = await db
    .select({
      id: inAppNotifications.id,
      memberId: inAppNotifications.memberId,
      type: inAppNotifications.type,
      title: inAppNotifications.title,
      body: inAppNotifications.body,
      postId: inAppNotifications.postId,
      commentId: inAppNotifications.commentId,
      metadata: inAppNotifications.metadata,
      readAt: inAppNotifications.readAt,
      archivedAt: inAppNotifications.archivedAt,
      createdAt: inAppNotifications.createdAt,
      postTitle: posts.title,
      boardSlug: boards.slug,
    })
    .from(inAppNotifications)
    .leftJoin(posts, eq(inAppNotifications.postId, posts.id))
    .leftJoin(boards, eq(posts.boardId, boards.id))
    .where(where)
    .orderBy(desc(inAppNotifications.createdAt))
    .limit(limit)
    .offset(offset)

  // Count total (for pagination)
  const totalResult = await db
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(inAppNotifications)
    .where(where)
  const total = totalResult[0]?.count ?? 0

  // Count unread
  const unreadResult = await db
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(inAppNotifications)
    .where(and(baseWhere, isNull(inAppNotifications.readAt)))
  const unreadCount = unreadResult[0]?.count ?? 0

  const notifications: NotificationWithPost[] = rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    postId: row.postId,
    commentId: row.commentId,
    metadata: row.metadata as Record<string, unknown> | null,
    readAt: row.readAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    post: row.postId
      ? {
          id: row.postId,
          title: row.postTitle!,
          boardSlug: row.boardSlug!,
        }
      : null,
  }))

  return {
    notifications,
    total,
    unreadCount,
    hasMore: offset + limit < total,
  }
}

/**
 * Get unread notification count for a member (optimized for badge display)
 */
export async function getUnreadCount(memberId: MemberId): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(inAppNotifications)
    .where(
      and(
        eq(inAppNotifications.memberId, memberId),
        isNull(inAppNotifications.archivedAt),
        isNull(inAppNotifications.readAt)
      )
    )

  return result[0]?.count ?? 0
}

/**
 * Mark a single notification as read
 */
export async function markAsRead(
  memberId: MemberId,
  notificationId: NotificationId
): Promise<void> {
  // Verify ownership and update in single query
  const result = await db
    .update(inAppNotifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(inAppNotifications.id, notificationId), eq(inAppNotifications.memberId, memberId))
    )
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('NOTIFICATION_NOT_FOUND', 'Notification not found')
  }
}

/**
 * Mark all notifications as read for a member
 */
export async function markAllAsRead(memberId: MemberId): Promise<void> {
  await db
    .update(inAppNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(inAppNotifications.memberId, memberId),
        isNull(inAppNotifications.archivedAt),
        isNull(inAppNotifications.readAt)
      )
    )
}

/**
 * Archive (soft delete) a notification
 */
export async function archiveNotification(
  memberId: MemberId,
  notificationId: NotificationId
): Promise<void> {
  const existing = await db.query.inAppNotifications.findFirst({
    where: and(
      eq(inAppNotifications.id, notificationId),
      eq(inAppNotifications.memberId, memberId)
    ),
  })

  if (!existing) {
    throw new NotFoundError('NOTIFICATION_NOT_FOUND', 'Notification not found')
  }

  await db
    .update(inAppNotifications)
    .set({ archivedAt: new Date() })
    .where(eq(inAppNotifications.id, notificationId))
}

/**
 * Archive all notifications for a member
 */
export async function archiveAllNotifications(memberId: MemberId): Promise<void> {
  await db
    .update(inAppNotifications)
    .set({ archivedAt: new Date() })
    .where(and(eq(inAppNotifications.memberId, memberId), isNull(inAppNotifications.archivedAt)))
}
