import type {
  DefaultError,
  EnsureQueryDataOptions,
  QueryClient,
  QueryKey,
} from '@tanstack/react-query'

/** An `ensureQueryData` of another shape, such as a `readBatch` loader's. */
type Ensure = <TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>
) => Promise<TData>

/**
 * Best-effort `ensureQueryData` for a route loader: the read is warmed into
 * the cache when it can be, and a failure is left to the page's own query
 * rather than failing the loader. `via` is the query client, or the ensure
 * function of a `readBatch` so the read joins that batch.
 */
export function warmQuery<
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  via: QueryClient | Ensure,
  options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>
): Promise<TData | undefined> {
  const read = typeof via === 'function' ? via(options) : via.ensureQueryData(options)
  return read.catch(() => undefined)
}
