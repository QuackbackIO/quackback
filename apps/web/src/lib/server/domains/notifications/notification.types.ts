/**
 * Notification Types
 *
 * Type definitions for in-app notifications
 */

import type { NotificationId, PostId, CommentId, PrincipalId } from '@quackback/ids'

/**
 * Notification event types that can trigger in-app notifications
 */
export type NotificationType =
  | 'post_status_changed'
  | 'comment_created'
  | 'post_mentioned'
  | 'changelog_published'

/**
 * Input for creating a single notification
 */
export interface CreateNotificationInput {
  principalId: PrincipalId
  type: NotificationType
  title: string
  body?: string
  postId?: PostId
  commentId?: CommentId
  metadata?: Record<string, unknown>
}

/**
 * Notification as stored in the database
 */
export interface Notification {
  id: NotificationId
  principalId: PrincipalId
  type: NotificationType
  title: string
  body: string | null
  postId: PostId | null
  commentId: CommentId | null
  metadata: Record<string, unknown> | null
  readAt: Date | null
  archivedAt: Date | null
  createdAt: Date
}

/**
 * Notification with related entities for display
 */
export interface NotificationWithPost extends Notification {
  post?: {
    id: PostId
    title: string
    boardSlug: string
  } | null
}

/**
 * Result from paginated notification queries
 */
export interface NotificationListResult {
  notifications: NotificationWithPost[]
  total: number
  unreadCount: number
  hasMore: boolean
}

/**
 * Options for querying notifications
 */
export interface GetNotificationsOptions {
  limit?: number
  offset?: number
  unreadOnly?: boolean
}
