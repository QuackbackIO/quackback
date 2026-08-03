/**
 * Ticket activity timeline — read-only query helper.
 *
 * Used by the MCP tool `get_ticket_activity` and the public REST route
 * `GET /api/v1/tickets/:ticketId/activity`. Permission filtering happens
 * at the call site (this module is pure data access).
 *
 * Returns rows in reverse-chronological order, joined to `principal` for
 * actor display name + avatar so consumers can render the timeline without
 * a follow-up lookup.
 */
import { db, eq, and, lt, desc, ticketActivity, principal } from '@/lib/server/db'
import type { TicketId, TicketActivityId, PrincipalId } from '@quackback/ids'

export interface TicketActivityRow {
  id: TicketActivityId
  ticketId: TicketId
  principalId: PrincipalId | null
  type: string
  metadata: unknown
  createdAt: Date
  actorName: string | null
  actorAvatarUrl: string | null
}

export interface ListTicketActivityOptions {
  /** ISO timestamp cursor — return rows strictly older than this. */
  before?: Date
  /** Default 50, hard cap 200. */
  limit?: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function listTicketActivity(
  ticketId: TicketId,
  opts: ListTicketActivityOptions = {}
): Promise<TicketActivityRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const conditions = [eq(ticketActivity.ticketId, ticketId)]
  if (opts.before) {
    conditions.push(lt(ticketActivity.createdAt, opts.before))
  }
  const rows = await db
    .select({
      id: ticketActivity.id,
      ticketId: ticketActivity.ticketId,
      principalId: ticketActivity.principalId,
      type: ticketActivity.type,
      metadata: ticketActivity.metadata,
      createdAt: ticketActivity.createdAt,
      actorName: principal.displayName,
      actorAvatarUrl: principal.avatarUrl,
    })
    .from(ticketActivity)
    .leftJoin(principal, eq(ticketActivity.principalId, principal.id))
    .where(and(...conditions))
    .orderBy(desc(ticketActivity.createdAt))
    .limit(limit)
  return rows as TicketActivityRow[]
}
