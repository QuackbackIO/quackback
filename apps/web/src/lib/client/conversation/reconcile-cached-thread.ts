import type { QueryClient } from '@tanstack/react-query'

/**
 * Keep a hover-prefetched (or previously opened) thread in sync with an SSE
 * event without creating caches for unvisited rows.
 *
 * - Data already in cache: run `apply` (the same reducer the open thread uses).
 * - In flight with a subscriber (the open pane): wait for that fetch, then
 *   apply. Cancelling would leave the mounted `useQuery` on a skeleton with
 *   nothing to restart it.
 * - In flight with no subscriber (hover prefetch): cancel it. Otherwise the
 *   prefetch response can land after this event and stay fresh, so selecting
 *   the row would omit the event and not refetch.
 */
export function reconcileCachedThread<T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  apply: (prev: T | undefined) => T | undefined
): void {
  const query = queryClient.getQueryCache().find<T>({ queryKey, exact: true })
  if (!query) return
  if (query.state.data !== undefined) {
    queryClient.setQueryData<T>(queryKey, (prev) => apply(prev))
    return
  }
  if (query.getObserversCount() > 0) {
    void query
      .fetch()
      .then(() => {
        queryClient.setQueryData<T>(queryKey, (prev) => apply(prev))
      })
      .catch(() => {})
    return
  }
  void queryClient.cancelQueries({ queryKey, exact: true })
}
