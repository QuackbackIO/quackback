import type { ReconcileDeps } from './reconciler'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'config-report-status' })

/**
 * Build the post-reconcile status reporter for `ReconcileDeps`.
 *
 * Posts the reconcile outcome to the optional status endpoint
 * configured via env (`QUACKBACK_CP_STATUS_URL`,
 * `QUACKBACK_CP_INTERNAL_TOKEN`, `QUACKBACK_INSTANCE_ID`). Env vars are
 * read at call time so a deployment that injects them late doesn't
 * require a restart. With no env configured the call is a silent no-op.
 *
 * One retry on transient failure to avoid stranding the status during a
 * brief outage. 400 responses are treated as success — the server is
 * rejecting an out-of-order POST, which is benign.
 *
 * Lives outside deps.ts so unit tests can drive it without dragging the
 * db / redis import graph in.
 */
export function makeReportStatus(): NonNullable<ReconcileDeps['reportStatus']> {
  return async (status) => {
    const url = process.env.QUACKBACK_CP_STATUS_URL
    const token = process.env.QUACKBACK_CP_INTERNAL_TOKEN
    const instanceId = process.env.QUACKBACK_INSTANCE_ID
    if (!url || !token || !instanceId) return

    const body = JSON.stringify({
      instanceId,
      reconciledAt: new Date().toISOString(),
      ...status,
    })
    const post = () =>
      fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body,
      })

    try {
      const res = await post()
      if (res.ok || res.status === 400) return
      throw new Error(`status ${res.status}`)
    } catch (firstErr) {
      // Single retry after 1s. Avoids long retry tails interfering
      // with the next reconcile tick.
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const res = await post()
        if (!res.ok && res.status !== 400) {
          throw new Error(`status ${res.status}`, { cause: firstErr })
        }
      } catch (retryErr) {
        log.error({ err: retryErr }, 'status report failed after retry')
      }
    }
  }
}
