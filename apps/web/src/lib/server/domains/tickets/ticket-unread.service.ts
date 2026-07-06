/**
 * Ticket read receipts (unified inbox §3.3), mirroring the conversation unread
 * model (conversation.query.ts's unreadCountFor / batched list-unread query,
 * conversation.service.ts's markConversationRead) but against
 * conversation_messages WHERE ticket_id = X. A ticket message's senderType
 * discriminates the side ('agent' == assignee, 'visitor' == requester) the
 * same way ticket-message.service.ts's insertTicketMessage does; internal
 * notes and soft-deleted messages never count toward either side's unread.
 */
import {
  db,
  conversationMessages,
  tickets,
  eq,
  and,
  or,
  inArray,
  isNull,
  gt,
  sql,
} from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'

export type TicketUnreadSide = 'requester' | 'assignee'

/** Count messages on the other side that arrived after this side last read. */
export async function unreadCountForTicket(
  ticketId: TicketId,
  side: TicketUnreadSide
): Promise<number> {
  const [ticket] = await db
    .select({
      requesterLastReadAt: tickets.requesterLastReadAt,
      assigneeLastReadAt: tickets.assigneeLastReadAt,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  const otherSide = side === 'assignee' ? 'visitor' : 'agent'
  const readAt = side === 'assignee' ? ticket?.assigneeLastReadAt : ticket?.requesterLastReadAt

  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.ticketId, ticketId),
        eq(conversationMessages.senderType, otherSide),
        isNull(conversationMessages.deletedAt),
        // Internal notes never count toward unread (esp. for the requester side).
        eq(conversationMessages.isInternal, false),
        // Use the gt() operator (not a raw sql template) so the Date watermark
        // is bound through Drizzle's timestamp encoder, mirroring
        // conversation.query.ts's unreadCountFor.
        readAt ? gt(conversationMessages.createdAt, readAt) : undefined
      )
    )
  return row?.c ?? 0
}

/**
 * Batched requester-authored unread count for a page of tickets, for list
 * enrichment (mirrors conversation.query.ts's listConversationsForAgent
 * unread-rows query). Only tickets with at least one unread message appear in
 * the returned map.
 */
export async function ticketUnreadMapForAgent(
  ticketIds: TicketId[]
): Promise<Map<TicketId, number>> {
  const map = new Map<TicketId, number>()
  if (ticketIds.length === 0) return map

  const rows = await db
    .select({
      ticketId: conversationMessages.ticketId,
      c: sql<number>`count(*)::int`,
    })
    .from(conversationMessages)
    .innerJoin(tickets, eq(tickets.id, conversationMessages.ticketId))
    .where(
      and(
        inArray(conversationMessages.ticketId, ticketIds),
        eq(conversationMessages.senderType, 'visitor'),
        isNull(conversationMessages.deletedAt),
        // Internal notes never count toward unread — defense-in-depth
        // mirroring unreadCountForTicket (visitor messages are never internal).
        eq(conversationMessages.isInternal, false),
        or(
          isNull(tickets.assigneeLastReadAt),
          sql`${conversationMessages.createdAt} > ${tickets.assigneeLastReadAt}`
        )
      )
    )
    .groupBy(conversationMessages.ticketId)

  // The inner join on tickets guarantees a non-null ticket_id.
  for (const row of rows) map.set(row.ticketId as TicketId, row.c)
  return map
}

/** Mark a ticket read for the assignee (agent) side. */
export async function markTicketReadForAgent(
  ticketId: TicketId,
  at: Date = new Date()
): Promise<void> {
  await db.update(tickets).set({ assigneeLastReadAt: at }).where(eq(tickets.id, ticketId))
}

/** Mark a ticket read for the requester side. */
export async function markTicketReadForRequester(
  ticketId: TicketId,
  at: Date = new Date()
): Promise<void> {
  await db.update(tickets).set({ requesterLastReadAt: at }).where(eq(tickets.id, ticketId))
}
