/**
 * SQL for the ticket due-date filters (lib/shared/ticket-due.ts's
 * TICKET_DUE_FILTERS), shared by the ticket list (`listTickets`) and the
 * conversation list's linked-ticket predicate (`pair-link.ts`), which may not
 * import the tickets domain. Columns are referenced through the drizzle
 * `tickets` table, so a caller must keep `tickets` unaliased in scope.
 *
 * "Open" here means `resolved_at IS NULL` (the lifecycle stamp a closed-category
 * status sets and a reopen clears), so a resolved ticket is never overdue.
 */
import type { SQL } from 'drizzle-orm'
import { sql, tickets } from '@/lib/server/db'
import { TICKET_DUE_SOON_WINDOW_MS, type TicketDueFilter } from '@/lib/shared/ticket-due'

export function ticketDueConditionSql(filter: TicketDueFilter, now: Date): SQL {
  const at = now.toISOString()
  switch (filter) {
    case 'overdue':
      return sql`(${tickets.dueAt} IS NOT NULL AND ${tickets.resolvedAt} IS NULL AND ${tickets.dueAt} <= ${at}::timestamptz)`
    case 'due_soon': {
      const until = new Date(now.getTime() + TICKET_DUE_SOON_WINDOW_MS).toISOString()
      return sql`(${tickets.resolvedAt} IS NULL AND ${tickets.dueAt} > ${at}::timestamptz AND ${tickets.dueAt} <= ${until}::timestamptz)`
    }
    case 'none':
      return sql`${tickets.dueAt} IS NULL`
  }
}
