/**
 * Notification mutations
 *
 * Mutation hooks for notification management (read, archive).
 * Query hooks are in @/lib/client/hooks/use-notifications-queries.
 */

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { NotificationId } from '@quackback/ids'
import {
  markNotificationAsReadFn,
  markAllNotificationsAsReadFn,
  archiveNotificationFn,
  archiveAllReadNotificationsFn,
} from '@/lib/server/functions/notifications'
import {
  notificationsKeys,
  type NotificationsListResult,
} from '@/lib/client/hooks/use-notifications-queries'

// ============================================================================
// Cache helpers
// ============================================================================

/**
 * The `notificationsKeys.lists()` prefix matches both the dropdown's plain
 * `NotificationsListResult` entry and the admin/portal pages' paginated
 * `InfiniteData<NotificationsListResult>` entries. Every optimistic update
 * below runs through this helper so it transforms whichever shape it's
 * handed (one page, or every page of an infinite entry) without corrupting
 * the `pages`/`pageParams` structure react-query expects back.
 */
type NotificationsCacheEntry = NotificationsListResult | InfiniteData<NotificationsListResult>

function updateNotificationPages(
  old: NotificationsCacheEntry | undefined,
  transform: (page: NotificationsListResult) => NotificationsListResult
): NotificationsCacheEntry | undefined {
  if (!old) return old
  if ('pages' in old) {
    return { ...old, pages: old.pages.map(transform) }
  }
  return transform(old)
}

/** Every loaded notification across a cache entry, whichever shape it is. */
function allNotifications(data: NotificationsCacheEntry | undefined) {
  if (!data) return []
  const pages = 'pages' in data ? data.pages : [data]
  return pages.flatMap((page) => page.notifications)
}

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

      // Optimistically update the notification wherever it's loaded. `total`/
      // `unreadCount` are process-wide counts replicated on every page, so the
      // decrement is applied uniformly to every page (not just page[0], which
      // is the only one the UI currently reads) to keep every page's snapshot
      // internally consistent; the onSettled invalidation is the source of truth.
      queryClient.setQueriesData<NotificationsCacheEntry>(
        { queryKey: notificationsKeys.lists() },
        (old) =>
          updateNotificationPages(old, (page) => ({
            ...page,
            notifications: page.notifications.map((n) =>
              n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n
            ),
            unreadCount: Math.max(0, page.unreadCount - 1),
          }))
      )

      // Optimistically update the standalone unread count query
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

      // Optimistically mark every loaded notification (on every page, in every
      // cache entry) as read and zero each page's unreadCount.
      queryClient.setQueriesData<NotificationsCacheEntry>(
        { queryKey: notificationsKeys.lists() },
        (old) =>
          updateNotificationPages(old, (page) => ({
            ...page,
            notifications: page.notifications.map((n) => ({
              ...n,
              readAt: n.readAt ?? new Date().toISOString(),
            })),
            unreadCount: 0,
          }))
      )

      queryClient.setQueryData<number>(notificationsKeys.unreadCount(), 0)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationsKeys.all })
    },
  })
}

export function useArchiveAllReadNotifications() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => archiveAllReadNotificationsFn(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationsKeys.all })

      // Optimistically drop every read row (on every page, in every cache
      // entry) and shrink each page's `total` by however many of its own
      // rows were removed. `unreadCount` is untouched — this action never
      // touches unread notifications.
      queryClient.setQueriesData<NotificationsCacheEntry>(
        { queryKey: notificationsKeys.lists() },
        (old) =>
          updateNotificationPages(old, (page) => {
            const removedCount = page.notifications.filter((n) => n.readAt !== null).length
            return {
              ...page,
              notifications: page.notifications.filter((n) => n.readAt === null),
              total: page.total - removedCount,
            }
          })
      )
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

      // Determine whether the notification was unread by scanning every page
      // of every loaded cache entry up front (the dropdown's plain list and
      // any infinite pages) — `unreadCount`/`total` are global counts, so this
      // has to be resolved once before mutating any entry, not re-detected
      // per entry (the notification may only be loaded in one of them).
      const existingLists = queryClient.getQueriesData<NotificationsCacheEntry>({
        queryKey: notificationsKeys.lists(),
      })
      const wasUnread = existingLists.some(([, data]) => {
        const found = allNotifications(data).find((n) => n.id === notificationId)
        return !!(found && !found.readAt)
      })

      // Optimistically remove it from every page it appears on.
      queryClient.setQueriesData<NotificationsCacheEntry>(
        { queryKey: notificationsKeys.lists() },
        (old) =>
          updateNotificationPages(old, (page) => ({
            ...page,
            notifications: page.notifications.filter((n) => n.id !== notificationId),
            total: page.total - 1,
            unreadCount: wasUnread ? Math.max(0, page.unreadCount - 1) : page.unreadCount,
          }))
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
