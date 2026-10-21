/**
 * Ticket due-date sweeper: a per-minute job that sends the due-soon and
 * overdue alerts for open tickets (see ticket-due.sweep.ts's
 * sweepTicketDueAlerts).
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`. Every collaborator is imported statically so
 * `primeJobHandlers()` loads it outside any workspace scope; see
 * sla-breach-sweep-queue.ts for why that matters.
 */
import { logger } from '@/lib/server/logger'
import { dueWithin, registerWorkspaceDeadline } from '@/lib/server/jobs/deadlines'
import { nextTicketDueAlertAt, sweepTicketDueAlerts } from './ticket-due.sweep'

const log = logger.child({ component: 'ticket-due-sweep' })

registerWorkspaceDeadline('ticket-due-sweep', nextTicketDueAlertAt)

/**
 * The cron gate: does any ticket's next due-date alert fall inside the next
 * slot?
 *
 * The window is the schedule's own minute, so this can only ever suppress a tick
 * that would have found nothing: an alert still goes out within a minute of
 * falling due.
 */
export function isTicketDueSweepDue(): Promise<boolean> {
  return dueWithin('ticket-due-sweep', 60_000)
}

export async function runTicketDueSweep(): Promise<void> {
  const result = await sweepTicketDueAlerts()
  if (result.dueSoon > 0 || result.overdue > 0 || result.silenced > 0) {
    log.debug(result, 'ticket-due-sweep run complete')
  }
}
