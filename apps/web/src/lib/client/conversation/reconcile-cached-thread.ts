import type { QueryClient } from '@tanstack/react-query'

/**
 * Keep a hover-prefetched (or previously opened) thread in sync with an SSE
 * event without creating caches for unvisited rows.
 *
 * - Data already in cache: run `apply` immediately.
 * - A fetch is in flight: run `apply` again after it settles, so a snapshot
 *   that missed this event cannot overwrite the patch and stay fresh.
 * - In flight with no data and no subscriber (hover prefetch): cancel it.
 *   Cancelling a mounted first fetch would leave the open pane on a skeleton
 *   with nothing to restart it.
 */
export function reconcileCachedThread<T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  apply: (prev: T | undefined) => T | undefined
): void {
  const query = queryClient.getQueryCache().find<T>({ queryKey, exact: true })
  if (!query) return

  const applyNow = () => {
    queryClient.setQueryData<T>(queryKey, (prev) => apply(prev))
  }

  if (query.state.data !== undefined) applyNow()

  if (query.state.fetchStatus !== 'fetching') return

  if (query.state.data !== undefined || query.getObserversCount() > 0) {
    void query
      .fetch()
      .then(applyNow)
      .catch(() => {})
    return
  }

  void queryClient.cancelQueries({ queryKey, exact: true })
}
