/**
 * SLA breach sweeper — a per-minute job that records breaches for conversations
 * whose stamped deadline has passed with no settling event (see
 * sweepOverdueSlaBreaches). The lazy evaluator in sla.event-hooks.ts only fires
 * on agent reply / close, so without this sweep a conversation that blows its
 * deadline in silence would never be marked breached. The ticket-anchored TTR
 * clock (ticket-sla.sweep.ts's sweepOverdueTicketSlaBreaches) runs in the same
 * job: its lazy evaluator only fires on ticket status changes, so a ticket that
 * blows its deadline with no status move needs the sweep just the same.
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`.
 *
 * The sweep modules are imported STATICALLY. They used to be `await import(...)`
 * inside the handler, which is a scope hazard rather than a style choice: the
 * tier opens a tenant scope around every pass, so a call-time import runs the
 * imported module's top level under whichever tenant happened to trigger it
 * first. `primeJobHandlers()` loads this module before any scope is open, and
 * static imports are what make that cover the modules the work actually lives
 * in. `__tests__/handler-imports.test.ts` keeps it that way.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'
import { dueWithin, registerTenantDeadline } from '@/lib/server/jobs/deadlines'
import { sweepOverdueSlaBreaches } from './sla.sweep'
import { sweepOverdueTicketSlaBreaches } from './ticket-sla.sweep'

const log = logger.child({ component: 'sla-breach-sweep' })

/**
 * The earliest SLA clock this tenant has that is still running unsettled — or
 * null, if it has none.
 *
 * Four clocks across two tables, and each arm restates its sweep's own eligible
 * condition rather than approximating it: a clock is a candidate only while its
 * due instant is set, its settled marker is unset and its breached marker is
 * unset. An arm that dropped one of those tests would report a deadline for a
 * clock that has already been answered, which costs a wake; an arm that added
 * one would hide a clock that has not, which costs a breach going unnoticed. The
 * second is the one that matters, so the conditions are copied verbatim.
 *
 * `paused_at` is honoured for the same reason `scanSlaClockCandidates` honours
 * it: a paused clock is not counting down, so its stored due instant is not a
 * deadline.
 *
 * The due values are ISO-8601 strings inside a JSON column, which compare
 * lexicographically exactly as they compare chronologically — the property
 * `sla.sweep.ts` already relies on for its window predicate.
 */
async function nextSlaBreachAt(): Promise<Date | null> {
  const result = await db.execute(sql`
    SELECT LEAST(
      (SELECT min(LEAST(
                CASE WHEN sla_applied ->> 'firstResponseAt' IS NULL
                      AND sla_applied ->> 'firstResponseBreachedAt' IS NULL
                     THEN sla_applied ->> 'firstResponseDueAt' END,
                CASE WHEN sla_applied ->> 'nextResponseAt' IS NULL
                      AND sla_applied ->> 'nextResponseBreachedAt' IS NULL
                     THEN sla_applied ->> 'nextResponseDueAt' END,
                CASE WHEN sla_applied ->> 'resolvedAt' IS NULL
                      AND sla_applied ->> 'resolutionBreachedAt' IS NULL
                     THEN sla_applied ->> 'timeToCloseDueAt' END))
         FROM conversations
        WHERE sla_applied IS NOT NULL AND (sla_applied ->> 'pausedAt') IS NULL),
      (SELECT min(CASE WHEN sla_applied ->> 'resolvedAt' IS NULL
                        AND sla_applied ->> 'resolutionBreachedAt' IS NULL
                       THEN sla_applied ->> 'timeToResolveDueAt' END)
         FROM tickets
        WHERE sla_applied IS NOT NULL AND (sla_applied ->> 'pausedAt') IS NULL)
    ) AS due_at
  `)
  const rows = getExecuteRows<{ due_at: string | null }>(result)
  const value = rows[0]?.due_at ?? null
  if (value === null) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
}

registerTenantDeadline('sla-breach-sweep', nextSlaBreachAt)

/**
 * The cron gate: is any clock due inside the next slot?
 *
 * The window is the schedule's own minute, so this can only ever suppress a tick
 * that would have found nothing — a breach is still recorded within a minute of
 * falling due, exactly as before.
 */
export function isSlaBreachSweepDue(): Promise<boolean> {
  return dueWithin('sla-breach-sweep', 60_000)
}

export async function runSlaBreachSweep(): Promise<void> {
  const result = await sweepOverdueSlaBreaches()
  // The ticket-anchored TTR twin — same per-minute tick, same exactly-once
  // marker discipline on its own stamp.
  const ticketResult = await sweepOverdueTicketSlaBreaches()
  if (result.recorded > 0 || ticketResult.recorded > 0) {
    log.debug(
      { recorded: result.recorded, ticketRecorded: ticketResult.recorded },
      'sla-breach-sweep run complete'
    )
  }
}
