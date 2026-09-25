/**
 * One request for a settings page's reads.
 *
 * Moving between settings pages runs the next page's loader in the browser,
 * and every read it warmed was a request of its own, each resolving the
 * caller's session and permissions again. A loader that warms its reads
 * through `settingsReadBatch` instead sends the ones not yet cached as one
 * request (`readSettingsTogetherFn`), which runs each read's own query
 * function. Each result then fills that read's cache entry under its own key
 * and options, as fetching it alone would have.
 *
 * Nothing about a read's outcome changes. A read the batch could not answer
 * (a permission the caller lacks, an error, a read missing from
 * `lib/server/settings-read-registry.ts`) is fetched on its own, so its error
 * reaches the loader exactly as before; the batch failing as a whole leaves
 * every read to its own fetch. In a document request the reads run in
 * process, as they always did, so there is nothing to batch.
 */
import {
  hashKey,
  isServer,
  type DefaultError,
  type EnsureQueryDataOptions,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { readSettingsTogetherFn } from '@/lib/server/functions/settings-reads'

type AnyRead = EnsureQueryDataOptions<unknown, DefaultError, unknown, QueryKey>

/**
 * Reads on their way in a batch, by query hash, so a second loader asking for
 * one (a hover's preload and the click after it) waits for that batch rather
 * than sending the read again, as `ensureQueryData` joins a fetch in flight.
 */
const inBatch = new WeakMap<QueryClient, Map<string, Promise<void>>>()

/**
 * `ensureQueryData` for one loader, whose reads made in the same tick (one
 * `Promise.all`) share one request. Each call resolves or rejects as
 * `queryClient.ensureQueryData` would for that read.
 */
export function settingsReadBatch(queryClient: QueryClient) {
  let collecting: AnyRead[] | null = null
  let sent: Promise<void> = Promise.resolve()
  const reads = inBatch.get(queryClient) ?? new Map<string, Promise<void>>()
  inBatch.set(queryClient, reads)

  return function ensure<
    TQueryFnData,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>): Promise<TData> {
    if (isServer) return queryClient.ensureQueryData(options)
    const state = queryClient.getQueryState(options.queryKey)
    if (state?.data !== undefined || state?.fetchStatus === 'fetching') {
      return queryClient.ensureQueryData(options)
    }
    const hash = hashKey(options.queryKey)
    const joined = reads.get(hash)
    if (joined) return joined.then(() => queryClient.ensureQueryData(options))
    if (!collecting) {
      const batch: AnyRead[] = (collecting = [])
      sent = Promise.resolve()
        .then(() => {
          collecting = null
          return fill(queryClient, batch)
        })
        .catch(() => undefined)
        .finally(() => {
          for (const read of batch) reads.delete(hashKey(read.queryKey))
        })
    }
    collecting.push(options as unknown as AnyRead)
    reads.set(hash, sent)
    return sent.then(() => queryClient.ensureQueryData(options))
  }
}

/** The server knows reads by their keys, which are lists of strings. */
const namedByKey = (read: AnyRead): read is AnyRead & { queryKey: string[] } =>
  read.queryKey.every((part) => typeof part === 'string')

async function fill(queryClient: QueryClient, reads: AnyRead[]): Promise<void> {
  const byKey = new Map<string, AnyRead & { queryKey: string[] }>()
  for (const read of reads) if (namedByKey(read)) byKey.set(hashKey(read.queryKey), read)
  const unique = [...byKey.values()]
  // A lone read gains nothing from the batch.
  if (unique.length < 2) return

  let results: Awaited<ReturnType<typeof readSettingsTogetherFn>>
  try {
    results = await readSettingsTogetherFn({
      data: { reads: unique.map((read) => read.queryKey) },
    })
  } catch {
    return
  }
  unique.forEach((read, i) => {
    const result = results[i]
    // Another fetch of the same read may have landed meanwhile; it wins.
    if (!result?.ok || queryClient.getQueryData(read.queryKey) !== undefined) return
    queryClient.getQueryCache().build(queryClient, queryClient.defaultQueryOptions(read))
    queryClient.setQueryData(read.queryKey, result.data)
  })
}
