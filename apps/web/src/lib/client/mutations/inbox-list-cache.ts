/**
 * Inbox infinite-list cache patches.
 *
 * Facet-count queries sit under the same `inboxKeys.lists()` prefix so list
 * invalidation also refreshes counts. Those entries are not `{ pages }`
 * infinite-query data. Any updater that assumes that shape must skip them.
 */

import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import type { InboxPostListResult, PostListItem } from '@/lib/shared/db-types'
import type { PostId } from '@quackback/ids'

export function isInboxInfiniteList(old: unknown): old is InfiniteData<InboxPostListResult> {
  if (!old || typeof old !== 'object') return false
  const pages = (old as { pages?: unknown }).pages
  if (!Array.isArray(pages)) return false
  return pages.every((page) => {
    if (page === null || typeof page !== 'object') return false
    return Array.isArray((page as { items?: unknown }).items)
  })
}

export function updatePostInInboxLists(
  queryClient: QueryClient,
  postId: PostId,
  updater: (post: PostListItem) => PostListItem
): void {
  queryClient.setQueriesData({ queryKey: inboxKeys.lists() }, (old) => {
    if (!isInboxInfiniteList(old)) return old
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        items: page.items.map((post) => (post.id === postId ? updater(post) : post)),
      })),
    }
  })
}

export function removePostFromInboxLists(queryClient: QueryClient, postId: PostId): void {
  queryClient.setQueriesData({ queryKey: inboxKeys.lists() }, (old) => {
    if (!isInboxInfiniteList(old)) return old
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        items: page.items.filter((post) => post.id !== postId),
      })),
    }
  })
}
