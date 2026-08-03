/**
 * Read-only queries for SLA clocks (used by REST + queue summaries).
 */
import {
  db,
  eq,
  and,
  inArray,
  lte,
  asc,
  ticketSlaClocks,
  type TicketSlaClock,
} from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'

export async function getActiveClocksForTicket(ticketId: TicketId): Promise<TicketSlaClock[]> {
  return db
    .select()
    .from(ticketSlaClocks)
    .where(
      and(
        eq(ticketSlaClocks.ticketId, ticketId),
        inArray(ticketSlaClocks.state, ['running', 'paused', 'breached'])
      )
    )
    .orderBy(asc(ticketSlaClocks.dueAt))
}

export async function getAllClocksForTicket(ticketId: TicketId): Promise<TicketSlaClock[]> {
  return db
    .select()
    .from(ticketSlaClocks)
    .where(eq(ticketSlaClocks.ticketId, ticketId))
    .orderBy(asc(ticketSlaClocks.createdAt))
}

export interface ListBreachingOptions {
  /** Include clocks whose dueAt is within `windowMinutes` from now (default 0 = breached only). */
  windowMinutes?: number
  limit?: number
}

export async function listBreachingClocks(
  opts: ListBreachingOptions = {}
): Promise<TicketSlaClock[]> {
  const window = opts.windowMinutes ?? 0
  const cutoff = new Date(Date.now() + window * 60_000)
  return db
    .select()
    .from(ticketSlaClocks)
    .where(and(eq(ticketSlaClocks.state, 'running'), lte(ticketSlaClocks.dueAt, cutoff)))
    .orderBy(asc(ticketSlaClocks.dueAt))
    .limit(opts.limit ?? 200)
}
