/**
 * Process role — controls whether this instance consumes background queues.
 *
 * QUACKBACK_ROLE=web     Serve HTTP only. Queue modules stay producer-only:
 *                        they can enqueue and register schedules, but never
 *                        construct a BullMQ Worker.
 * QUACKBACK_ROLE=worker  Run BullMQ workers + periodic sweepers. Still serves
 *                        HTTP (health probes work unchanged); just don't route
 *                        user traffic to it.
 * QUACKBACK_ROLE=all     Both — the default, matching single-container
 *                        self-host deployments.
 *
 * Read directly from process.env (not the zod config) so the check works in
 * any context without a full config load, mirroring `helpCenterDev`.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'process-role' })

export type ProcessRole = 'web' | 'worker' | 'all'

let warnedInvalid = false

export function getProcessRole(): ProcessRole {
  const raw = process.env.QUACKBACK_ROLE
  if (!raw || raw === 'all') return 'all'
  if (raw === 'web' || raw === 'worker') return raw
  if (!warnedInvalid) {
    warnedInvalid = true
    log.warn(
      { role: raw },
      "invalid QUACKBACK_ROLE (expected 'web' | 'worker' | 'all'), defaulting to 'all'"
    )
  }
  return 'all'
}

/**
 * Whether this process should consume queues (BullMQ Workers) and run the
 * periodic sweepers wired in startup.ts. False only under QUACKBACK_ROLE=web.
 */
export function shouldRunWorkers(): boolean {
  return getProcessRole() !== 'web'
}
