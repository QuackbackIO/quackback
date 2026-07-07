/**
 * Server functions for in-app notification operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { NotificationId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import {
  getNotificationsForMember,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotification,
  archiveAllNotifications,
} from '@/lib/server/domains/notifications/notification.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'notifications' })

// ============================================
// Schemas
// ============================================

const getNotificationsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  unreadOnly: z.boolean().optional().default(false),
})

const notificationIdSchema = z.object({
  notificationId: z.string(),
})

// ============================================
// Read Operations
// ============================================

/**
 * Get notifications for the current user with pagination
 */
export const getNotificationsFn = createServerFn({ method: 'GET' })
  .validator(getNotificationsSchema)
  .handler(async ({ data }) => {
    log.debug(
      { limit: data.limit, offset: data.offset, unread_only: data.unreadOnly },
      'get notifications'
    )
    try {
      const auth = await requireAuth()
      // Resolve the actor so audience-denied posts get their preview
      // hidden in the notification list.
      const actor = await policyActorFromAuth(auth)

      const result = await getNotificationsForMember(
        auth.principal.id,
        {
          limit: data.limit,
          offset: data.offset,
          unreadOnly: data.unreadOnly,
        },
        actor
      )

      // Serialize dates for JSON transport
      return {
        notifications: result.notifications.map((n) => {
          // Conversation notifications carry their target conversation in metadata so
          // the client can deep-link into the inbox.
          const conversationId = n.metadata?.conversationId
          const ticketId = n.metadata?.ticketId
          const changelogId = n.metadata?.changelogId
          const incidentId = n.metadata?.incidentId
          // Older comment_created rows predate actorName and only carry
          // commenterName — fall back so their avatar still renders.
          const actorName = n.metadata?.actorName ?? n.metadata?.commenterName
          const actorAvatarUrl = n.metadata?.actorAvatarUrl
          return {
            id: n.id,
            principalId: n.principalId,
            type: n.type,
            title: n.title,
            body: n.body,
            postId: n.postId,
            commentId: n.commentId,
            conversationId: typeof conversationId === 'string' ? conversationId : null,
            ticketId: typeof ticketId === 'string' ? ticketId : null,
            changelogId: typeof changelogId === 'string' ? changelogId : null,
            incidentId: typeof incidentId === 'string' ? incidentId : null,
            actorName: typeof actorName === 'string' ? actorName : null,
            actorAvatarUrl: typeof actorAvatarUrl === 'string' ? actorAvatarUrl : null,
            readAt: n.readAt?.toISOString() ?? null,
            archivedAt: n.archivedAt?.toISOString() ?? null,
            createdAt: n.createdAt.toISOString(),
            post: n.post,
          }
        }),
        total: result.total,
        unreadCount: result.unreadCount,
        hasMore: result.hasMore,
      }
    } catch (error) {
      log.error({ err: error }, 'get notifications failed')
      throw error
    }
  })

/**
 * Get unread notification count for the current user (for badge display)
 */
export const getUnreadCountFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug({}, 'get unread count')
  try {
    const auth = await requireAuth()
    const count = await getUnreadCount(auth.principal.id)
    return { count }
  } catch (error) {
    log.error({ err: error }, 'get unread count failed')
    throw error
  }
})

// ============================================
// Write Operations
// ============================================

/**
 * Mark a single notification as read
 */
export const markNotificationAsReadFn = createServerFn({ method: 'POST' })
  .validator(notificationIdSchema)
  .handler(async ({ data }) => {
    log.info({ notification_id: data.notificationId }, 'notification marked read')
    try {
      const auth = await requireAuth()
      await markAsRead(auth.principal.id, data.notificationId as NotificationId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'mark notification read failed')
      throw error
    }
  })

/**
 * Mark all notifications as read for the current user
 */
export const markAllNotificationsAsReadFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info({}, 'all notifications marked read')
  try {
    const auth = await requireAuth()
    await markAllAsRead(auth.principal.id)
    return { success: true }
  } catch (error) {
    log.error({ err: error }, 'mark all notifications read failed')
    throw error
  }
})

/**
 * Archive (soft delete) a notification
 */
export const archiveNotificationFn = createServerFn({ method: 'POST' })
  .validator(notificationIdSchema)
  .handler(async ({ data }) => {
    log.info({ notification_id: data.notificationId }, 'notification archived')
    try {
      const auth = await requireAuth()
      await archiveNotification(auth.principal.id, data.notificationId as NotificationId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'archive notification failed')
      throw error
    }
  })

/**
 * Archive all read (but not unread) notifications for the current user
 */
export const archiveAllReadNotificationsFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    log.info({}, 'all read notifications archived')
    try {
      const auth = await requireAuth()
      await archiveAllNotifications(auth.principal.id, { onlyRead: true })
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'archive all read notifications failed')
      throw error
    }
  }
)
