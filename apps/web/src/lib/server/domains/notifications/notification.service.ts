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
  isNotNull,
  sql,
  inAppNotifications,
  posts,
  boards,
  type Transaction,
} from '@/lib/server/db'
import type { NotificationId, PrincipalId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { ANONYMOUS_ACTOR, boardViewFilter, canViewPost, type Actor } from '@/lib/server/policy'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'notifications' })
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
  log.debug({ count: inputs.length }, 'create notifications batch')
  if (inputs.length === 0) return []

  const executor = tx ?? db

  const rows = await executor
    .insert(inAppNotifications)
    .values(
      inputs.map((input) => ({
        id: createId('notification'),
        principalId: input.principalId,
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
  log.debug(
    { notification_type: input.type, principal_id: input.principalId },
    'create notification'
  )
  const [id] = await createNotificationsBatch([input], tx)
  return id
}

/**
 * Get notifications for a member with pagination.
 *
 * The `actor` parameter drives per-board audience filtering on the
 * post/board left-joins: if the user once subscribed to a post whose
 * board has since become team-only or segment-restricted, the post
 * preview (title + boardSlug) gets nulled out for that row instead
 * of leaking. The notification row itself stays (preserves history).
 */
export async function getNotificationsForMember(
  principalId: PrincipalId,
  options: GetNotificationsOptions = {},
  actor: Actor = ANONYMOUS_ACTOR
): Promise<NotificationListResult> {
  const { limit = 20, offset = 0, unreadOnly = false } = options

  // Build where clause
  const baseWhere = and(
    eq(inAppNotifications.principalId, principalId),
    isNull(inAppNotifications.archivedAt)
  )

  const where = unreadOnly ? and(baseWhere, isNull(inAppNotifications.readAt)) : baseWhere

  // Get notifications with post details. Both joins are filtered:
  //   - posts: only join non-deleted rows. A soft-deleted post would
  //     otherwise still satisfy `eq(notifications.postId, posts.id)`
  //     and its stored title would leak via row.postTitle even though
  //     the post is gone.
  //   - boards: also gated by boardViewFilter(actor) so an audience-
  //     restricted board returns null boardSlug.
  // The mapper below treats any deny (no post OR no board) as a
  // redaction — both the link AND the stored title/body/metadata
  // (which embed the post title and comment preview) are replaced
  // with a neutral placeholder.
  const rows = await db
    .select({
      id: inAppNotifications.id,
      principalId: inAppNotifications.principalId,
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
      postModerationState: posts.moderationState,
      postPrincipalId: posts.principalId,
      boardSlug: boards.slug,
      boardAccess: boards.access,
    })
    .from(inAppNotifications)
    .leftJoin(posts, and(eq(inAppNotifications.postId, posts.id), isNull(posts.deletedAt)))
    .leftJoin(
      boards,
      and(eq(posts.boardId, boards.id), isNull(boards.deletedAt), boardViewFilter(actor))
    )
    .where(where)
    .orderBy(desc(inAppNotifications.createdAt))
    .limit(limit)
    .offset(offset)

  // Total (for pagination) and unread counts are independent of each other and
  // of the list query above, so fire them in parallel rather than serially.
  const [totalResult, unreadResult] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(inAppNotifications)
      .where(where),
    db
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(inAppNotifications)
      .where(and(baseWhere, isNull(inAppNotifications.readAt))),
  ])
  const total = totalResult[0]?.count ?? 0
  const unreadCount = unreadResult[0]?.count ?? 0

  const notifications: NotificationWithPost[] = rows.map((row) => {
    // Three ways a postId-bearing notification can be denied:
    //   1. The board's audience excludes the actor (boardViewFilter
    //      returned null boardSlug).
    //   2. The post is soft-deleted (left join returned null because
    //      of the isNull(posts.deletedAt) filter above).
    //   3. The post is in a moderation state the actor can't see
    //      (pending/spam for non-team, except own-pending) — checked
    //      explicitly via canViewPost.
    // Any of those redact title/body/metadata to a neutral placeholder
    // so the row stays in the feed without disclosing post text or
    // comment preview embedded at notification creation time.
    let denied = false
    if (row.postId !== null) {
      if (!row.postTitle || !row.boardSlug || !row.boardAccess) {
        // The post was deleted, the board was deleted, or the
        // board-audience join was filtered out.
        denied = true
      } else {
        const decision = canViewPost(
          actor,
          {
            moderationState: row.postModerationState ?? 'published',
            principalId: row.postPrincipalId,
          },
          { access: row.boardAccess }
        )
        if (!decision.allowed) denied = true
      }
    }
    return {
      id: row.id,
      principalId: row.principalId,
      type: row.type as NotificationType,
      title: denied ? 'Notification' : row.title,
      body: denied ? 'This activity is no longer visible to you.' : row.body,
      postId: row.postId,
      commentId: row.commentId,
      metadata: denied ? null : (row.metadata as Record<string, unknown> | null),
      readAt: row.readAt,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      post:
        row.postId && row.postTitle && row.boardSlug && !denied
          ? {
              id: row.postId,
              title: row.postTitle,
              boardSlug: row.boardSlug,
            }
          : null,
    }
  })

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
export async function getUnreadCount(principalId: PrincipalId): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(inAppNotifications)
    .where(
      and(
        eq(inAppNotifications.principalId, principalId),
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
  principalId: PrincipalId,
  notificationId: NotificationId
): Promise<void> {
  log.debug(
    { principal_id: principalId, notification_id: notificationId },
    'mark notification as read'
  )
  // Verify ownership and update in single query
  const result = await db
    .update(inAppNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(inAppNotifications.id, notificationId),
        eq(inAppNotifications.principalId, principalId)
      )
    )
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('NOTIFICATION_NOT_FOUND', 'Notification not found')
  }
}

/**
 * Mark all notifications as read for a member
 */
export async function markAllAsRead(principalId: PrincipalId): Promise<void> {
  log.debug({ principal_id: principalId }, 'mark all notifications as read')
  await db
    .update(inAppNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(inAppNotifications.principalId, principalId),
        isNull(inAppNotifications.archivedAt),
        isNull(inAppNotifications.readAt)
      )
    )
}

/**
 * Archive (soft delete) a notification
 */
export async function archiveNotification(
  principalId: PrincipalId,
  notificationId: NotificationId
): Promise<void> {
  log.debug({ principal_id: principalId, notification_id: notificationId }, 'archive notification')
  const existing = await db.query.inAppNotifications.findFirst({
    where: and(
      eq(inAppNotifications.id, notificationId),
      eq(inAppNotifications.principalId, principalId)
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
 * Archive all notifications for a member. Pass `{ onlyRead: true }` to
 * archive just the read ones, leaving unread notifications in place.
 */
export async function archiveAllNotifications(
  principalId: PrincipalId,
  options: { onlyRead?: boolean } = {}
): Promise<void> {
  const { onlyRead = false } = options
  log.debug({ principal_id: principalId, only_read: onlyRead }, 'archive all notifications')
  await db
    .update(inAppNotifications)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(inAppNotifications.principalId, principalId),
        isNull(inAppNotifications.archivedAt),
        onlyRead ? isNotNull(inAppNotifications.readAt) : undefined
      )
    )
}
