/**
 * Ticket activity service — the ticket-side activity log (mirrors the post
 * domain's activity.service). Records meaningful state changes on tickets:
 * creation, status transitions, assignment moves, priority changes, reopens.
 *
 * Inserts are fire-and-forget and never block or fail the parent operation;
 * reads resolve actor names from the principal table (null principal = a
 * system-initiated action).
 */

import { db, ticketActivity, eq, desc, principal as principalTable } from '@/lib/server/db'
import type { TicketId, PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ticket-activity' })

// ============================================
// Types
// ============================================

export type TicketActivityType =
  | 'ticket.created'
  | 'ticket.deleted'
  | 'status.changed'
  | 'ticket.assigned'
  | 'priority.changed'
  | 'ticket.reopened'

export interface RecordTicketActivityOpts {
  ticketId: TicketId
  /** Who performed the action; null for system-initiated actions. */
  principalId: PrincipalId | null
  type: TicketActivityType
  metadata?: Record<string, unknown>
}

export interface TicketActivityRow {
  id: string
  ticketId: string
  principalId: string | null
  type: TicketActivityType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>
  createdAt: Date
  actorName: string | null
}

// ============================================
// Create
// ============================================

/**
 * Record a ticket activity event. Fire-and-forget — never throws, so a
 * failed activity insert can never break the parent ticket operation.
 */
export function recordTicketActivity(opts: RecordTicketActivityOpts): void {
  db.insert(ticketActivity)
    .values({
      ticketId: opts.ticketId,
      principalId: opts.principalId,
      type: opts.type,
      metadata: opts.metadata ?? {},
    })
    .catch((err) => {
      log.error(
        { activity_type: opts.type, ticket_id: opts.ticketId, err },
        'failed to record ticket activity'
      )
    })
}

// ============================================
// Query
// ============================================

/**
 * Get activity for a ticket, newest first. Resolves actor names from the
 * principal table. Limited to the 200 most recent entries (the post-side
 * convention). The id tiebreak keeps same-timestamp rows (e.g. several
 * events inside one transaction) in insertion order — TypeIDs are
 * time-ordered.
 */
export async function listTicketActivity(ticketId: TicketId): Promise<TicketActivityRow[]> {
  const rows = await db
    .select({
      id: ticketActivity.id,
      ticketId: ticketActivity.ticketId,
      principalId: ticketActivity.principalId,
      type: ticketActivity.type,
      metadata: ticketActivity.metadata,
      createdAt: ticketActivity.createdAt,
      actorName: principalTable.displayName,
    })
    .from(ticketActivity)
    .leftJoin(principalTable, eq(ticketActivity.principalId, principalTable.id))
    .where(eq(ticketActivity.ticketId, ticketId))
    .orderBy(desc(ticketActivity.createdAt), desc(ticketActivity.id))
    .limit(200)

  return rows as TicketActivityRow[]
}
