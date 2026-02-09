/**
 * Notification query hooks
 *
 * Query hooks for fetching notification data.
 * Mutations are in @/lib/client/mutations/notifications.
 */

import { useQuery } from '@tanstack/react-query'
import type { NotificationId } from '@quackback/ids'
import { getNotificationsFn, getUnreadCountFn } from '@/lib/server/functions/notifications'

// ============================================================================
// Query Key Factory
// ============================================================================

export const notificationsKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationsKeys.all, 'list'] as const,
  list: (filters: { unreadOnly?: boolean }) => [...notificationsKeys.lists(), filters] as const,
  unreadCount: () => [...notificationsKeys.all, 'unreadCount'] as const,
}

// ============================================================================
// Types
// ============================================================================

export interface SerializedNotification {
  id: NotificationId
  principalId: string
  type: 'post_status_changed' | 'comment_created' | 'post_mentioned'
  title: string
  body: string | null
  postId: string | null
  commentId: string | null
  readAt: string | null
  archivedAt: string | null
  createdAt: string
  post?: {
    id: string
    title: string
    boardSlug: string
  } | null
}

export interface NotificationsListResult {
  notifications: SerializedNotification[]
  total: number
  unreadCount: number
  hasMore: boolean
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseNotificationsOptions {
  limit?: number
  offset?: number
  unreadOnly?: boolean
  enabled?: boolean
}

export function useNotifications({
  limit = 10,
  offset = 0,
  unreadOnly = false,
  enabled = true,
}: UseNotificationsOptions = {}): ReturnType<typeof useQuery<NotificationsListResult>> {
  return useQuery({
    queryKey: notificationsKeys.list({ unreadOnly }),
    queryFn: async () => {
      const result = await getNotificationsFn({ data: { limit, offset, unreadOnly } })
      return result as NotificationsListResult
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useUnreadCount(enabled = true): ReturnType<typeof useQuery<number>> {
  return useQuery({
    queryKey: notificationsKeys.unreadCount(),
    queryFn: async () => (await getUnreadCountFn()).count,
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}
