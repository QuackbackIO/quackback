/**
 * Notification query hooks
 *
 * Query hooks for fetching notification data.
 * Mutations are in @/lib/client/mutations/notifications.
 */

import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import type { NotificationId } from '@quackback/ids'
import type { NotificationType } from '@/lib/shared/types'
import { getNotificationsFn, getUnreadCountFn } from '@/lib/server/functions/notifications'

/** Page size for the infinite-scrolling notification pages (admin + portal). */
const NOTIFICATIONS_PAGE_SIZE = 30

// ============================================================================
// Query Key Factory
// ============================================================================

export const notificationsKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationsKeys.all, 'list'] as const,
  // Fixed-size list, keyed by filters only. Used by the notification dropdown
  // (limit 10). Kept as its own key (separate from `infiniteList` below) so
  // the dropdown and the full-page infinite lists never share a cache entry —
  // previously both went through `list`, so the dropdown's 10-row page and
  // the full page's 50-row page clobbered each other on every refetch.
  list: (filters: { unreadOnly?: boolean }) => [...notificationsKeys.lists(), filters] as const,
  // Paginated list used by the admin/portal notification pages.
  infiniteList: (filters: { unreadOnly?: boolean }) =>
    [...notificationsKeys.lists(), 'infinite', filters] as const,
  unreadCount: () => [...notificationsKeys.all, 'unreadCount'] as const,
}

// ============================================================================
// Types
// ============================================================================

export interface SerializedNotification {
  id: NotificationId
  principalId: string
  type: NotificationType
  title: string
  body: string | null
  postId: string | null
  commentId: string | null
  /** Target conversation for conversation notifications (from metadata); null otherwise. */
  conversationId: string | null
  /** Target ticket for ticket notifications (from metadata); null otherwise. */
  ticketId: string | null
  /** Target changelog entry for changelog notifications (from metadata); null otherwise. */
  changelogId: string | null
  /** Target status incident for status notifications (from metadata); null otherwise. */
  incidentId: string | null
  /** Display name of the person who triggered this notification (from metadata); null for system-driven types. */
  actorName: string | null
  /** Avatar URL for the actor (from metadata); null when unavailable. */
  actorAvatarUrl: string | null
  /** Which app this row's deep link belongs to (from metadata, ticket bells only):
   *  'portal' for the requester, 'admin' for agent watchers; null on older rows. */
  audience: 'admin' | 'portal' | null
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

interface UseInfiniteNotificationsOptions {
  unreadOnly?: boolean
}

/**
 * Paginated notification list for the admin/portal notification pages.
 * Loads {@link NOTIFICATIONS_PAGE_SIZE} rows per page; call `fetchNextPage`
 * (typically from a "Load more" button) to fetch subsequent pages.
 */
export function useInfiniteNotifications({
  unreadOnly = false,
}: UseInfiniteNotificationsOptions = {}) {
  return useInfiniteQuery({
    queryKey: notificationsKeys.infiniteList({ unreadOnly }),
    queryFn: async ({ pageParam }) => {
      const result = await getNotificationsFn({
        data: { limit: NOTIFICATIONS_PAGE_SIZE, offset: pageParam, unreadOnly },
      })
      return result as NotificationsListResult
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * NOTIFICATIONS_PAGE_SIZE : undefined,
    // Offset inverts trivially (offset - page size, floored at 0). This hook
    // is shared by both the admin and portal notification pages — capped at
    // the admin tier (5) per QC-2's bucket list; notification pages rarely
    // accumulate more than a couple of pages regardless.
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 0 ? Math.max(0, firstPageParam - NOTIFICATIONS_PAGE_SIZE) : undefined,
    maxPages: 5,
    staleTime: 30_000,
    // Refetches every already-loaded page on each tick (one queryFn call per
    // page). Acceptable at this scale — notification pages rarely accumulate
    // more than a couple of pages before a user acts on them.
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
