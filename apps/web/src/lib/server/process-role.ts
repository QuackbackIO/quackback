/**
 * Process role — controls whether this instance consumes background queues.
 *
 * QUACKBACK_ROLE=web     Serve HTTP only. Queue modules stay producer-only:
 *                        they can enqueue and register schedules, but nothing
 *                        claims a job.
 * QUACKBACK_ROLE=worker  Run the job tier and the periodic sweepers. Still
 *                        serves HTTP (health probes work unchanged); just
 *                        don't route user traffic to it.
 * QUACKBACK_ROLE=all     Both — the default, matching single-container
 *                        self-host deployments.
 * QUACKBACK_ROLE=migrator Reconcile workspace schemas toward the control plane's
 *                        recorded intent, then exit (SAAS-HOSTING-STACK.md
 *                        §10.3). Serves no traffic and runs no queues: it holds
 *                        a DIRECT session-mode connection per workspace it is
 *                        working, which is the one thing that must never share
 *                        a process with the pooled web tier, because holding a
 *                        connection open is exactly what stops a Neon compute
 *                        suspending.
 *
 * Read directly from process.env (not the zod config) so the check works in
 * any context without a full config load, mirroring `helpCenterDev`.
 *
 * An unrecognised value fails CLOSED — see `UNRECOGNISED_ROLE_FALLBACK`.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'process-role' })

export const PROCESS_ROLES = ['web', 'worker', 'all', 'migrator'] as const
export type ProcessRole = (typeof PROCESS_ROLES)[number]

/**
 * The role an unrecognised value falls back to.
 *
 * **Not `all`.** The old code warned and returned `all`, which is fail-OPEN
 * into the exact topology the design forbids: measured, `QUACKBACK_ROLE=banana`
 * — and `MIGRATOR`, and `Migrator` — booted the Postgres job tier and the
 * sweepers together. A typo in a deployment manifest is not a licence to run
 * every background subsystem against every workspace.
 *
 * `web` is the closed direction: it serves HTTP and starts nothing. A fleet
 * that briefly runs no background work is degraded and obvious; a fleet where
 * one mistyped replica runs every worker is neither.
 *
 * The startup path calls {@link assertProcessRoleConfigured} and refuses to
 * boot, so in practice this fallback is the second line, not the first.
 */
const UNRECOGNISED_ROLE_FALLBACK: ProcessRole = 'web'

let warnedInvalid = false

/**
 * Parse `QUACKBACK_ROLE`.
 *
 * The allowlist is over the **environment string**, not over the `ProcessRole`
 * union. Checking the union is what let a case typo through: `MIGRATOR` failed
 * every `raw === '...'` comparison, fell to the default, and the default was
 * `all`. Whitespace is trimmed because a trailing space is an artefact of YAML
 * and shell quoting rather than an intent; case is not folded, because two
 * accepted spellings for one role is how configuration drifts.
 */
function parseRole(raw: string | undefined): { role: ProcessRole; recognised: boolean } {
  if (raw === undefined || raw.trim() === '') return { role: 'all', recognised: true }
  const value = raw.trim()
  if ((PROCESS_ROLES as readonly string[]).includes(value)) {
    return { role: value as ProcessRole, recognised: true }
  }
  return { role: UNRECOGNISED_ROLE_FALLBACK, recognised: false }
}

export function getProcessRole(): ProcessRole {
  const { role, recognised } = parseRole(process.env.QUACKBACK_ROLE)
  if (!recognised && !warnedInvalid) {
    warnedInvalid = true
    log.error(
      { role: process.env.QUACKBACK_ROLE, fallback: role },
      `unrecognised QUACKBACK_ROLE (expected one of ${PROCESS_ROLES.join(' | ')}); ` +
        `falling back to '${role}', which starts NO background work. Fix the value: this ` +
        'process is not doing the job its deployment thinks it is.'
    )
  }
  return role
}

/** Test seam — the warn-once latch would otherwise hide the second case. */
export function __resetRoleWarningForTests(): void {
  warnedInvalid = false
}

export class InvalidProcessRole extends Error {
  constructor(raw: string) {
    super(
      `QUACKBACK_ROLE='${raw}' is not one of ${PROCESS_ROLES.join(' | ')}. Refusing to start: ` +
        'the previous behaviour was to fall back to `all`, which boots the job tier and the ' +
        'sweepers — so a typo silently produced the one topology pooled tenancy forbids.'
    )
    this.name = 'InvalidProcessRole'
  }
}

/**
 * Refuse to boot on an unrecognised role.
 *
 * The fallback above keeps a running process safe; this keeps a mistyped one
 * from running at all, which is the outcome an operator can actually see.
 */
export function assertProcessRoleConfigured(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env.QUACKBACK_ROLE
  if (!parseRole(raw).recognised) throw new InvalidProcessRole(String(raw))
}

/**
 * Whether this process should claim jobs and run the periodic sweepers wired in
 * startup.ts.
 *
 * An allowlist rather than `!== 'web'`, and that is load-bearing: the old form
 * would have said *true* for every role added after it, so `migrator` would have
 * silently booted the job tier's fifteen queues and six sweepers alongside a
 * fleet migration. A negative test over an open set answers for values it has
 * never heard of.
 */
export function shouldRunWorkers(): boolean {
  const role = getProcessRole()
  return role === 'worker' || role === 'all'
}

/** Whether this process is the fleet migrator. Serves nothing, queues nothing. */
export function isMigratorRole(): boolean {
  return getProcessRole() === 'migrator'
}
