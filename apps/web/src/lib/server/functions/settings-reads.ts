/**
 * Several settings reads in one request, for a settings page's loader in the
 * browser (`lib/client/queries/settings-batch.ts`).
 *
 * It holds no authority of its own. Each read named is a registered query
 * (`lib/server/settings-read-registry.ts`), and each runs that query's own
 * function, which calls the server function the page would otherwise call on
 * its own: the same gate, the same data, the same shaping. A read the caller
 * may not make fails alone and comes back as not read; the others still
 * answer. Running together they resolve the caller's session and permissions
 * once, where separate requests resolved them once each.
 */
import { createServerFn } from '@tanstack/react-start'
import { QueryClient, hashKey, type FetchQueryOptions } from '@tanstack/react-query'
import { z } from 'zod'

/** A read's data (any query's, so only known not to be undefined), or that it was not read. */
export type SettingsReadResult = { ok: true; data: {} | null } | { ok: false }

type SettingsRead = (typeof import('@/lib/server/settings-read-registry'))['SETTINGS_READS'][number]

/** The registered reads by the hash of their query key, built on the first request. */
let registeredReads: Map<string, SettingsRead> | undefined

export const readSettingsTogetherFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      // Each read is named by its query key.
      reads: z
        .array(z.array(z.string().max(128)).min(1).max(8))
        .min(1)
        .max(32),
    })
  )
  .handler(async ({ data }): Promise<SettingsReadResult[]> => {
    const { SETTINGS_READS } = await import('@/lib/server/settings-read-registry')
    const registered = (registeredReads ??= new Map(
      SETTINGS_READS.map((read) => [hashKey(read().queryKey), read])
    ))
    // A client of its own, so no read is cached beyond this request.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const settled = await Promise.allSettled(
      data.reads.map((key) => {
        const read = registered.get(hashKey(key))
        if (!read) return Promise.reject(new Error('unknown read'))
        // Every registered read is a complete queryOptions() of its own data type.
        return queryClient.fetchQuery(read() as FetchQueryOptions)
      })
    )
    return settled.map((result) =>
      result.status === 'fulfilled' ? { ok: true, data: result.value as {} | null } : { ok: false }
    )
  })
