/**
 * Event-loop lag on a serving replica, logged when it is high. CPU work on
 * the request thread (an image walked, a PNG drawn) holds every other
 * request on the replica; this is how that shows up in the logs. The
 * delay is sampled continuously and, once a minute, logged as a warning
 * when its p99 passed the threshold; quiet otherwise.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { logger } from '@/lib/server/logger'

export interface LagLog {
  warn: (fields: Record<string, number>, message: string) => void
}

const ms = (ns: number) => Math.round(ns / 1e6)

/** Starts the sampling; gives a function that stops it. */
export function startEventLoopLagLog(
  opts: { everyMs?: number; warnAboveMs?: number; log?: LagLog } = {}
): () => void {
  const { everyMs = 60_000, warnAboveMs = 200 } = opts
  const log = opts.log ?? logger.child({ component: 'event-loop' })
  const delay = monitorEventLoopDelay({ resolution: 20 })
  delay.enable()
  const timer = setInterval(() => {
    const p99 = ms(delay.percentile(99))
    if (p99 > warnAboveMs)
      log.warn(
        { p50Ms: ms(delay.percentile(50)), p99Ms: p99, maxMs: ms(delay.max) },
        'event loop lagging: requests on this replica waited'
      )
    delay.reset()
  }, everyMs)
  timer.unref()
  return () => {
    clearInterval(timer)
    delay.disable()
  }
}
