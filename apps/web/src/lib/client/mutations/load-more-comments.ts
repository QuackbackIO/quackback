/**
 * "Show more comments" loaders for the three post-detail surfaces.
 *
 * Comments are keyset-paginated by ROOT comment on the server. The first page
 * is embedded in the post-detail payload (SSR-streamed on the portal), and
 * subsequent pages are appended INTO that same `.comments` array in the detail
 * cache. Keeping one coherent tree in one cache entry means every existing
 * comment mutation (create/edit/delete/react/pin) keeps working untouched —
 * they all patch `.comments`.
 */
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import { fetchPublicPostDetail } from '@/lib/server/functions/portal'
import { fetchPostWithDetails } from '@/lib/server/functions/posts'
import type { PublicPostDetailView, PublicCommentView } from '@/lib/client/queries/portal-detail'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'

/** Minimal shape the appender needs from any post-detail cache entry. */
interface CommentPagedDetail {
  comments: PublicCommentView[]
  commentsHasMore?: boolean
  commentsNextCursor?: string | null
  commentsTotalRootCount?: number
}

/**
 * Merge a freshly-fetched page of root comments into an existing detail cache
 * entry. New roots are appended after the ones already loaded (chronological
 * keyset order), de-duped by id so a concurrent optimistic insert can't double
 * up. `hasMore`/`nextCursor` advance to the new page.
 */
export function appendCommentPage<T extends CommentPagedDetail>(
  old: T,
  page: {
    comments: PublicCommentView[]
    commentsHasMore?: boolean
    commentsNextCursor?: string | null
    commentsTotalRootCount?: number
  }
): T {
  const seen = new Set(old.comments.map((c) => c.id))
  const appended = page.comments.filter((c) => !seen.has(c.id))
  return {
    ...old,
    comments: [...old.comments, ...appended],
    commentsHasMore: page.commentsHasMore ?? false,
    commentsNextCursor: page.commentsNextCursor ?? null,
    commentsTotalRootCount: page.commentsTotalRootCount ?? old.commentsTotalRootCount,
  }
}

interface LoadMoreState {
  loadMore: () => Promise<void>
  isLoading: boolean
  hasMore: boolean
}

/**
 * Portal post-detail "show more comments". Reads/writes the
 * `['portal','post',postId]` cache the route already prefetched.
 */
export function useLoadMorePortalComments(
  postId: PostId,
  queryKey: QueryKey = ['portal', 'post', postId]
): LoadMoreState {
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)

  const current = queryClient.getQueryData<PublicPostDetailView>(queryKey)
  const hasMore = !!current?.commentsHasMore

  const loadMore = useCallback(async () => {
    const detail = queryClient.getQueryData<PublicPostDetailView>(queryKey)
    if (!detail?.commentsHasMore || !detail.commentsNextCursor) return
    setIsLoading(true)
    try {
      const page = (await fetchPublicPostDetail({
        data: { postId, commentsCursor: detail.commentsNextCursor },
      })) as PublicPostDetailView | null
      if (!page) return
      queryClient.setQueryData<PublicPostDetailView>(queryKey, (old) =>
        old ? appendCommentPage(old, page) : old
      )
    } finally {
      setIsLoading(false)
    }
  }, [queryClient, postId, queryKey])

  return { loadMore, isLoading, hasMore }
}

/**
 * Widget post-detail "show more comments". Same append semantics against the
 * widget's session-versioned cache key; carries the Bearer identity headers.
 */
export function useLoadMoreWidgetComments(
  postId: PostId,
  queryKey: QueryKey,
  pageSize = 15
): LoadMoreState {
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)

  const current = queryClient.getQueryData<PublicPostDetailView>(queryKey)
  const hasMore = !!current?.commentsHasMore

  const loadMore = useCallback(async () => {
    const detail = queryClient.getQueryData<PublicPostDetailView>(queryKey)
    if (!detail?.commentsHasMore || !detail.commentsNextCursor) return
    setIsLoading(true)
    try {
      const page = (await fetchPublicPostDetail({
        data: { postId, commentsCursor: detail.commentsNextCursor, commentsLimit: pageSize },
        headers: getWidgetAuthHeaders(),
      })) as PublicPostDetailView | null
      if (!page) return
      queryClient.setQueryData<PublicPostDetailView>(queryKey, (old) =>
        old ? appendCommentPage(old, page) : old
      )
    } finally {
      setIsLoading(false)
    }
  }, [queryClient, postId, queryKey, pageSize])

  return { loadMore, isLoading, hasMore }
}

/**
 * Admin post-detail "show more comments". Appends into the
 * `['inbox','detail',postId]` cache used by the post modal. The admin detail
 * payload carries the same comment-page fields via `fetchPostWithDetails`.
 */
export function useLoadMoreAdminComments(postId: PostId, queryKey: QueryKey): LoadMoreState {
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)

  const current = queryClient.getQueryData<CommentPagedDetail>(queryKey)
  const hasMore = !!current?.commentsHasMore

  const loadMore = useCallback(async () => {
    const detail = queryClient.getQueryData<CommentPagedDetail>(queryKey)
    if (!detail?.commentsHasMore || !detail.commentsNextCursor) return
    setIsLoading(true)
    try {
      const page = (await fetchPostWithDetails({
        data: { id: postId, commentsCursor: detail.commentsNextCursor },
      })) as unknown as {
        comments: PublicCommentView[]
        commentsHasMore?: boolean
        commentsNextCursor?: string | null
        commentsTotalRootCount?: number
      }
      queryClient.setQueryData<CommentPagedDetail>(queryKey, (old) =>
        old ? appendCommentPage(old, page) : old
      )
    } finally {
      setIsLoading(false)
    }
  }, [queryClient, postId, queryKey])

  return { loadMore, isLoading, hasMore }
}
