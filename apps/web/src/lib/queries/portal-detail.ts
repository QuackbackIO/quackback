import { queryOptions } from '@tanstack/react-query'
import type { BoardSlug, PostId } from '@quackback/ids'
import { getPublicBoardBySlug } from '@/lib/boards/board.public'
import { getPublicPostDetail } from '@/lib/posts/post.public'

/**
 * Query options factory for portal detail pages (board, post detail).
 * Uses service functions that return Result<T, E> types.
 * These are used with ensureQueryData() in loaders and useSuspenseQuery() in components.
 */
export const portalDetailQueries = {
  /**
   * Get public board by slug
   */
  board: (slug: BoardSlug) =>
    queryOptions({
      queryKey: ['portal', 'board', slug],
      queryFn: async () => {
        const result = await getPublicBoardBySlug(slug)
        if (!result.success) throw new Error(result.error.message)
        return result.value
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
        const result = await getPublicPostDetail(postId)
        if (!result.success) throw new Error(result.error.message)
        return result.value
      },
      staleTime: 30 * 1000, // 30s
    }),
}
