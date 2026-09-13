import type { QueryClient } from '@tanstack/react-query'

/**
 * Keep a hover-prefetched (or previously opened) thread in sync with an SSE
 * event without creating caches for unvisited rows.
 *
 * - Data already in cache: run `apply` (the same reducer the open thread uses).
 * - Query exists but is still in flight: cancel it. Otherwise the prefetch
 *   response can land after this event and stay fresh for the thread
 *   staleTime, so selecting the row would omit the event and not refetch.
 */
export function reconcileCachedThread<T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  apply: (prev: T | undefined) => T | undefined
): void {
  const state = queryClient.getQueryState<T>(queryKey)
  if (!state) return
  if (state.data !== undefined) {
    queryClient.setQueryData<T>(queryKey, (prev) => apply(prev))
    return
  }
  void queryClient.cancelQueries({ queryKey })
}
