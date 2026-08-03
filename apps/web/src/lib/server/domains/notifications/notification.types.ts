/**
 * Notification Types
 *
 * Type definitions for in-app notifications
 */

import type { NotificationId, PostId, CommentId, PrincipalId, TicketId } from '@quackback/ids'

/**
 * Notification event types that can trigger in-app notifications
 */
export type NotificationType =
  | 'post_status_changed'
  | 'comment_created'
  | 'post_mentioned'
  | 'changelog_published'
  | 'ticket_sla_warning'
  | 'ticket_sla_breach'
  | 'ticket_assigned'
  | 'ticket_unassigned'
  | 'ticket_thread_added'
  | 'ticket_status_changed'
  | 'ticket_participant_added'
  | 'ticket_participant_removed'
  | 'ticket_shared'
  | 'ticket_unshared'
  | 'chat_message'
  | 'chat_mention'

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
  ticketId?: TicketId
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
  ticketId: TicketId | null
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
