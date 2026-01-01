import { queryOptions } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import { fetchPublicBoardBySlug, fetchPublicPostDetail } from '@/lib/server-functions/portal'

/**
 * Query options factory for portal detail pages (board, post detail).
 * Uses server functions to keep database code server-only.
 * These are used with ensureQueryData() in loaders and useSuspenseQuery() in components.
 */
export const portalDetailQueries = {
  /**
   * Get public board by slug
   */
  board: (slug: string) =>
    queryOptions({
      queryKey: ['portal', 'board', slug],
      queryFn: async () => {
        const result = await fetchPublicBoardBySlug({ data: { slug } })
        if (!result) throw new Error('Board not found')
        return result
      },
      staleTime: 2 * 60 * 1000, // 2min
    }),

  /**
   * Get public post detail
   */
  postDetail: (postId: PostId) =>
    queryOptions({
      queryKey: ['portal', 'post', postId],
      queryFn: async () => {
        const result = await fetchPublicPostDetail({ data: { postId } })
        if (!result) throw new Error('Post not found')
        return result
      },
      staleTime: 30 * 1000, // 30s
    }),
}
