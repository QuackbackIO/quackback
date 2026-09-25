import { queryOptions } from '@tanstack/react-query'
import { listPendingCommentsFn, listPendingPostsFn } from '@/lib/server/functions/moderation'

/** The moderation queue: posts and comments awaiting review. */
export const moderationQueueQueries = {
  posts: () =>
    queryOptions({
      queryKey: ['admin', 'moderation', 'pending', 'posts'],
      queryFn: () => listPendingPostsFn(),
    }),
  comments: () =>
    queryOptions({
      queryKey: ['admin', 'moderation', 'pending', 'comments'],
      queryFn: () => listPendingCommentsFn(),
    }),
}
