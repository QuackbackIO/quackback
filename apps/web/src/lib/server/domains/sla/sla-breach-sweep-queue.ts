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
import { logger } from '@/lib/server/logger'
import { sweepOverdueSlaBreaches } from './sla.sweep'
import { sweepOverdueTicketSlaBreaches } from './ticket-sla.sweep'

const log = logger.child({ component: 'sla-breach-sweep' })

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
