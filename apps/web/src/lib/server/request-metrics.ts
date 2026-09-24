/**
 * Per-request work counters.
 *
 * Counts are deterministic where wall-clock time is not: the same page against
 * the same data runs the same number of queries on every run, so a count can
 * be compared against a checked-in ceiling and fail CI on one run. The access
 * log carries them as field data, and the Server-Timing header (opt-in) shows
 * them in the browser's network panel.
 *
 * The counters hang off the request's log context under a symbol key, like the
 * auth memo in `functions/auth-request-cache.ts`. Symbol keys survive the
 * `{ ...parent }` copy a workspace scope makes, so a child scope keeps counting
 * into the same object, and the logger's JSON output never includes them.
 */
import type { Logger } from 'drizzle-orm'
import { getLogContext } from '@/lib/server/log-context'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'db' })

const METRICS_KEY = Symbol.for('quackback.requestMetrics')

export interface RequestMetrics {
  /** Statements sent to Postgres, one per round trip Drizzle makes. */
  dbQueries: number
}

type MetricsCarrier = Record<PropertyKey, unknown>

/**
 * Attach a fresh counter to the active request scope and return it. Outside a
 * request scope there is nothing to attach to, and nothing is counted.
 */
export function openRequestMetrics(): RequestMetrics | undefined {
  const store = getLogContext() as MetricsCarrier | undefined
  if (!store) return undefined
  const metrics: RequestMetrics = { dbQueries: 0 }
  store[METRICS_KEY] = metrics
  return metrics
}

export function currentRequestMetrics(): RequestMetrics | undefined {
  const store = getLogContext() as MetricsCarrier | undefined
  return store?.[METRICS_KEY] as RequestMetrics | undefined
}

/**
 * Drizzle logger that counts statements into the active request. At debug
 * level it also logs each statement's text (never its parameters), which is
 * how a request's query count is traced back to the code that ran them.
 */
export const countingQueryLogger: Logger = {
  logQuery(query) {
    const metrics = currentRequestMetrics()
    if (metrics) metrics.dbQueries += 1
    if (log.isLevelEnabled('debug')) log.debug({ sql: query }, 'db query')
  },
}

export function formatServerTiming(metrics: RequestMetrics, durationMs: number): string {
  return `app;dur=${durationMs.toFixed(1)}, db;desc="${metrics.dbQueries} queries"`
}
