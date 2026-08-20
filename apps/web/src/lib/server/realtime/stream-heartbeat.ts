/**
 * SSE stream liveness: a ping that nobody consumes is how an abandoned tab
 * is distinguished from a live one.
 *
 * The chat stream writes presence on every successful ping. Without a timeout
 * those writes continue after the browser is gone (half-open TCP, a frozen
 * tab, a proxy that never aborts), which is one connection held against the
 * tenant for as long as the process lives. The heartbeat is the one signal
 * we have: if the previous ping is still sitting in the stream, the consumer
 * is gone, and the stream must tear down.
 */

export const SSE_HEARTBEAT_INTERVAL_MS = 20_000

/** Consecutive unconsumed pings before the stream is treated as abandoned. */
export const SSE_HEARTBEAT_MISS_LIMIT = 2

export type HeartbeatPingResult = 'ok' | 'closed' | 'unconsumed'

export interface StreamHeartbeat {
  stop(): void
}

export interface StreamHeartbeatOptions {
  sendPing: () => HeartbeatPingResult
  onTimeout: () => void
  onAlive?: () => void
  intervalMs?: number
  missLimit?: number
  /** Test seam. Production uses `setInterval`. */
  schedule?: (tick: () => void, ms: number) => { clear: () => void }
}

function defaultSchedule(tick: () => void, ms: number): { clear: () => void } {
  const id = setInterval(tick, ms)
  id.unref?.()
  return { clear: () => clearInterval(id) }
}

export function startStreamHeartbeat(opts: StreamHeartbeatOptions): StreamHeartbeat {
  const intervalMs = opts.intervalMs ?? SSE_HEARTBEAT_INTERVAL_MS
  const missLimit = opts.missLimit ?? SSE_HEARTBEAT_MISS_LIMIT
  let misses = 0
  let stopped = false

  const schedule = opts.schedule ?? defaultSchedule
  let clearer: { clear: () => void } | null = null

  const finish = () => {
    if (stopped) return
    stopped = true
    clearer?.clear()
  }

  const tick = () => {
    if (stopped) return
    const result = opts.sendPing()
    if (result === 'closed') {
      finish()
      opts.onTimeout()
      return
    }
    if (result === 'unconsumed') {
      misses += 1
      if (misses >= missLimit) {
        finish()
        opts.onTimeout()
      }
      return
    }
    misses = 0
    opts.onAlive?.()
  }

  clearer = schedule(tick, intervalMs)

  return {
    stop() {
      finish()
    },
  }
}
