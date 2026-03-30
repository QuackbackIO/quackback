/**
 * Server functions for in-app notification operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { NotificationId } from '@featurepool/ids'
import { requireAuth } from './auth-helpers'
import {
  getNotificationsForMember,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotification,
} from '@/lib/server/domains/notifications/notification.service'

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
  .inputValidator(getNotificationsSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:notifications] getNotificationsFn: limit=${data.limit}, offset=${data.offset}, unreadOnly=${data.unreadOnly}`
    )
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      const result = await getNotificationsForMember(auth.principal.id, {
        limit: data.limit,
        offset: data.offset,
        unreadOnly: data.unreadOnly,
      })

      // Serialize dates for JSON transport
      return {
        notifications: result.notifications.map((n) => ({
          id: n.id,
          principalId: n.principalId,
          type: n.type,
          title: n.title,
          body: n.body,
          postId: n.postId,
          commentId: n.commentId,
          readAt: n.readAt?.toISOString() ?? null,
          archivedAt: n.archivedAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
          post: n.post,
        })),
        total: result.total,
        unreadCount: result.unreadCount,
        hasMore: result.hasMore,
      }
    } catch (error) {
      console.error(`[fn:notifications] getNotificationsFn failed:`, error)
      throw error
    }
  })

/**
 * Get unread notification count for the current user (for badge display)
 */
export const getUnreadCountFn = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:notifications] getUnreadCountFn`)
  try {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const count = await getUnreadCount(auth.principal.id)
    return { count }
  } catch (error) {
    console.error(`[fn:notifications] getUnreadCountFn failed:`, error)
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
  .inputValidator(notificationIdSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:notifications] markNotificationAsReadFn: notificationId=${data.notificationId}`
    )
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await markAsRead(auth.principal.id, data.notificationId as NotificationId)
      return { success: true }
    } catch (error) {
      console.error(`[fn:notifications] markNotificationAsReadFn failed:`, error)
      throw error
    }
  })

/**
 * Mark all notifications as read for the current user
 */
export const markAllNotificationsAsReadFn = createServerFn({ method: 'POST' }).handler(async () => {
  console.log(`[fn:notifications] markAllNotificationsAsReadFn`)
  try {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    await markAllAsRead(auth.principal.id)
    return { success: true }
  } catch (error) {
    console.error(`[fn:notifications] markAllNotificationsAsReadFn failed:`, error)
    throw error
  }
})

/**
 * Archive (soft delete) a notification
 */
export const archiveNotificationFn = createServerFn({ method: 'POST' })
  .inputValidator(notificationIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:notifications] archiveNotificationFn: notificationId=${data.notificationId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await archiveNotification(auth.principal.id, data.notificationId as NotificationId)
      return { success: true }
    } catch (error) {
      console.error(`[fn:notifications] archiveNotificationFn failed:`, error)
      throw error
    }
  })
