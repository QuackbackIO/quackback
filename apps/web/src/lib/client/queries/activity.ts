import { queryOptions } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import { fetchActivityForPost } from '@/lib/server/functions/activity'

/**
 * Query options factory for post activity log.
 */
export const activityQueries = {
  /**
   * All activity for a single post (for Activity tab).
   */
  forPost: (postId: PostId) =>
    queryOptions({
      queryKey: ['activity', 'post', postId],
      queryFn: () => fetchActivityForPost({ data: { postId } }),
      staleTime: 15 * 1000,
    }),
}
