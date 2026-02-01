/**
 * Notification mutations
 *
 * Mutation hooks for notification management (read, archive).
 * Query hooks are in @/lib/hooks/use-notifications-queries.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { NotificationId } from '@quackback/ids'
import {
  markNotificationAsReadFn,
  markAllNotificationsAsReadFn,
  archiveNotificationFn,
} from '@/lib/server/functions/notifications'
import {
  notificationsKeys,
  type NotificationsListResult,
} from '@/lib/client/hooks/use-notifications-queries'

// ============================================================================
// Mutation Hooks
// ============================================================================

export function useMarkNotificationAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (notificationId: NotificationId) =>
      markNotificationAsReadFn({ data: { notificationId } }),
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: notificationsKeys.all })

      // Optimistically update notification in cache
      queryClient.setQueriesData<NotificationsListResult>(
        { queryKey: notificationsKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            notifications: old.notifications.map((n) =>
              n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n
            ),
            unreadCount: Math.max(0, old.unreadCount - 1),
          }
        }
      )

      // Optimistically update unread count
      queryClient.setQueryData<number>(notificationsKeys.unreadCount(), (old) =>
        old !== undefined ? Math.max(0, old - 1) : old
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationsKeys.all })
    },
  })
}

export function useMarkAllNotificationsAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => markAllNotificationsAsReadFn(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationsKeys.all })

      // Optimistically mark all as read
      queryClient.setQueriesData<NotificationsListResult>(
        { queryKey: notificationsKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            notifications: old.notifications.map((n) => ({
              ...n,
              readAt: n.readAt ?? new Date().toISOString(),
            })),
            unreadCount: 0,
          }
        }
      )

      queryClient.setQueryData<number>(notificationsKeys.unreadCount(), 0)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationsKeys.all })
    },
  })
}

export function useArchiveNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (notificationId: NotificationId) =>
      archiveNotificationFn({ data: { notificationId } }),
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: notificationsKeys.all })

      // Track if we need to decrement unread count
      let wasUnread = false

      // Optimistically remove from list
      queryClient.setQueriesData<NotificationsListResult>(
        { queryKey: notificationsKeys.lists() },
        (old) => {
          if (!old) return old
          const removed = old.notifications.find((n) => n.id === notificationId)
          wasUnread = !!(removed && !removed.readAt)
          return {
            ...old,
            notifications: old.notifications.filter((n) => n.id !== notificationId),
            total: old.total - 1,
            unreadCount: wasUnread ? old.unreadCount - 1 : old.unreadCount,
          }
        }
      )

      // Update standalone unread count query
      if (wasUnread) {
        queryClient.setQueryData<number>(notificationsKeys.unreadCount(), (c) =>
          c !== undefined ? Math.max(0, c - 1) : c
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationsKeys.all })
    },
  })
}
