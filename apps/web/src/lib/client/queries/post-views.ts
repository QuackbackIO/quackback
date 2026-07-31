import { queryOptions } from '@tanstack/react-query'
import { listPostViewsFn } from '@/lib/server/functions/post-views'

/** Saved feedback-inbox views (definitions only — running a view translates
 *  its stored filters into inbox filter state client-side). */
export const postViewQueries = {
  list: () =>
    queryOptions({
      queryKey: ['admin', 'post-views'],
      queryFn: () => listPostViewsFn(),
      staleTime: 60 * 1000,
    }),
}
