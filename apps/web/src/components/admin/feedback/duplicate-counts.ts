import type { PostId } from '@quackback/ids'

interface CountsQuery {
  status: 'pending' | 'error' | 'success'
  data?: ReadonlyArray<{ postId: PostId; count: number }>
}

/**
 * Merge every inbox page's pending-duplicate counts into one map. Undefined
 * only while a page's counts are still loading; once loaded, an empty map
 * means no loaded post has a suggestion, which the Has duplicates filter must
 * read as "nothing matches" rather than "skip the filter". A page whose counts
 * failed to load counts as having none.
 */
export function mergeDuplicateCounts(
  queries: ReadonlyArray<CountsQuery>
): Map<PostId, number> | undefined {
  if (queries.some((q) => q.status === 'pending')) return undefined
  const map = new Map<PostId, number>()
  for (const query of queries) {
    for (const item of query.data ?? []) {
      map.set(item.postId, item.count)
    }
  }
  return map
}
