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
 * QUACKBACK_ROLE=migrator Reconcile tenant schemas toward the control plane's
 *                        recorded intent, then exit (SAAS-HOSTING-STACK.md
 *                        §10.3). Serves no traffic and runs no queues: it holds
 *                        a DIRECT session-mode connection per tenant it is
 *                        working, which is the one thing that must never share
 *                        a process with the pooled web tier, because holding a
 *                        connection open is exactly what stops a Neon compute
 *                        suspending.
 *
 * Read directly from process.env (not the zod config) so the check works in
 * any context without a full config load, mirroring `helpCenterDev`.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'process-role' })

export type ProcessRole = 'web' | 'worker' | 'all' | 'migrator'

let warnedInvalid = false

export function getProcessRole(): ProcessRole {
  const raw = process.env.QUACKBACK_ROLE
  if (!raw || raw === 'all') return 'all'
  if (raw === 'web' || raw === 'worker' || raw === 'migrator') return raw
  if (!warnedInvalid) {
    warnedInvalid = true
    log.warn(
      { role: raw },
      "invalid QUACKBACK_ROLE (expected 'web' | 'worker' | 'all' | 'migrator'), defaulting to 'all'"
    )
  }
  return 'all'
}

/**
 * Whether this process should consume queues (BullMQ Workers) and run the
 * periodic sweepers wired in startup.ts.
 *
 * An allowlist rather than `!== 'web'`, and that is load-bearing: the old form
 * would have said *true* for every role added after it, so `migrator` would have
 * silently booted fifteen BullMQ workers and six sweepers alongside a fleet
 * migration. A negative test over an open set answers for values it has never
 * heard of.
 */
export function shouldRunWorkers(): boolean {
  const role = getProcessRole()
  return role === 'worker' || role === 'all'
}

/** Whether this process is the fleet migrator. Serves nothing, queues nothing. */
export function isMigratorRole(): boolean {
  return getProcessRole() === 'migrator'
}
