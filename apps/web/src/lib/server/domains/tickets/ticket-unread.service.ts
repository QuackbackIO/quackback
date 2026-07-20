/**
 * Ticket read receipts (unified inbox §3.3), mirroring the conversation unread
 * model (conversation.query.ts's unreadCountFor / batched list-unread query,
 * conversation.service.ts's markConversationRead) but against
 * conversation_messages WHERE ticket_id = X. A ticket message's senderType
 * discriminates the side ('agent' == assignee, 'visitor' == requester) the
 * same way ticket-message.service.ts's insertTicketMessage does; internal
 * notes and soft-deleted messages never count toward either side's unread.
 *
 * CONVERGENCE PHASE 2 — READ-THROUGH (scratchpad/convergence-design.md, "the
 * pair runs on the conversation's two watermarks"). A customer ticket and its
 * linked conversation are ONE item with ONE shared watermark per side; reading
 * either surface of the pair marks BOTH read (Intercom's "a ticket is marked
 * as read when the linked conversation is read"). The mark-read entry points
 * here therefore resolve the pair first and, for a linked customer ticket,
 * delegate to the conversation's own mark-read (which writes
 * `conversations.agent_last_read_at` / `visitor_last_read_at` and publishes
 * the conversation 'read' event) instead of touching the legacy ticket
 * columns. The legacy `tickets.*_last_read_at` columns stay live ONLY for
 * threads that kept their own ticket-scoped messages: back-office/tracker
 * tickets and not-yet-linked standalone customer tickets. Unread COUNTS for a
 * linked pair likewise read the conversation watermark (the requester list
 * badge — `requesterTicketUnreadMap` below); the accepted cutover glitch is
 * that an in-flight pair's legacy ticket-parented rows stop counting toward
 * unread the moment the conversation watermark wins.
 */
import {
  db,
  conversationMessages,
  conversations,
  tickets,
  ticketConversations,
  eq,
  and,
  or,
  inArray,
  isNull,
  gt,
  sql,
} from '@/lib/server/db'
import type { TicketId, ConversationId, ConversationMessageId } from '@quackback/ids'
import { publishTicketEvent } from '@/lib/server/realtime/conversation-channels'
import { unreadWatermarkFromAnchor } from '@/lib/server/domains/conversation/conversation.lifecycle'
import { assertTicketVisible } from './ticket.service'
import { resolvePairConversationId } from './pair-thread.service'
import { canActAsAgent } from '@/lib/server/policy/conversation'
import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError, ForbiddenError } from '@/lib/shared/errors'

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

/** Mark a ticket read for the assignee (agent) side. Publishes a 'ticket_read'
 *  (unified inbox §3.2, M3) so another tab/teammate's open thread or inbox
 *  list clears the badge live — `side: 'agent'` mirrors the conversation
 *  domain's read event exactly (see conversation-channels.ts).
 *
 *  CONVERGENCE PHASE 2 (read-through): on a linked customer pair the
 *  conversation's agent watermark is the pair's truth, so the write delegates
 *  to the conversation's own mark-read — the pair lists as its conversation
 *  row, and that row's badge reads `conversations.agentLastReadAt`. The
 *  delegate re-gates on conversation visibility (an agent who can't see the
 *  conversation can't hold its badge either — the row is conversationFilter-
 *  scoped out of their inbox) and derives the side ('agent' for a teammate).
 *  The legacy ticket column keeps being written ONLY for unlinked threads
 *  (back-office/tracker, standalone customer), which kept their own thread. */
export async function markTicketReadForAgent(
  ticketId: TicketId,
  actor: Actor,
  at: Date = new Date()
): Promise<void> {
  const pairConversationId = await resolvePairConversationId(ticketId)
  if (pairConversationId) {
    const { markConversationRead } =
      await import('@/lib/server/domains/conversation/conversation.service')
    await markConversationRead(pairConversationId, actor)
    return
  }
  await db.update(tickets).set({ assigneeLastReadAt: at }).where(eq(tickets.id, ticketId))
  publishTicketEvent(ticketId, {
    kind: 'ticket_read',
    ticketId,
    side: 'agent',
    at: at.toISOString(),
  })
}

/** Mark a ticket read for the requester side — the portal/widget ticket-page
 *  view (`markMyTicketRead` in requester.service is the caller; ownership is
 *  enforced there). Published as `side: 'visitor'` for symmetry, though
 *  nothing in the agent inbox reacts to it today (see
 *  `agentEventChangesInboxList`'s `ticket_read` branch).
 *
 *  CONVERGENCE PHASE 2 (read-through): on a linked pair the requester reading
 *  the ticket page marks the CONVERSATION's visitor watermark — the Messages
 *  space (portal/widget conversation list, messenger badge) lists the pair
 *  natively and reads that watermark, so one read clears both spaces. The
 *  delegate derives the 'visitor' side from the requester actor and re-gates
 *  on conversation visibility (the pair's conversation is the requester's
 *  own, so the ownership check the caller already ran carries over). Legacy
 *  ticket-column write + `ticket_read` publish only for unlinked threads. */
export async function markTicketReadForRequester(
  ticketId: TicketId,
  actor: Actor,
  at: Date = new Date()
): Promise<void> {
  const pairConversationId = await resolvePairConversationId(ticketId)
  if (pairConversationId) {
    const { markConversationRead } =
      await import('@/lib/server/domains/conversation/conversation.service')
    await markConversationRead(pairConversationId, actor)
    return
  }
  await db.update(tickets).set({ requesterLastReadAt: at }).where(eq(tickets.id, ticketId))
  publishTicketEvent(ticketId, {
    kind: 'ticket_read',
    ticketId,
    side: 'visitor',
    at: at.toISOString(),
  })
}

/**
 * Batched AGENT-authored unread count for a page of a requester's own tickets
 * (the portal/widget Tickets-space row badges), CONVERGENCE PHASE 2: a linked
 * pair's unread reads the CONVERSATION's visitor watermark and counts only the
 * conversation parent's agent messages (the pair's shared thread is authored
 * there post-1a; legacy ticket-parented rows stop counting — the accepted
 * cutover glitch the module doc notes). An unlinked standalone ticket keeps
 * the legacy ticket-parented count against `tickets.requesterLastReadAt`.
 * Only tickets with at least one unread message appear in the returned map.
 */
export async function requesterTicketUnreadMap(
  ticketIds: TicketId[]
): Promise<Map<TicketId, number>> {
  const map = new Map<TicketId, number>()
  if (ticketIds.length === 0) return map

  // Split the page into linked (pair) tickets and standalone ones — each group
  // counts against a different parent + watermark (see the doc comment).
  const links = await db
    .select({
      ticketId: ticketConversations.ticketId,
      conversationId: ticketConversations.conversationId,
    })
    .from(ticketConversations)
    .where(
      and(
        inArray(ticketConversations.ticketId, ticketIds),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
  const linkedByConversation = new Map<ConversationId, TicketId>()
  const linkedTicketIds = new Set<TicketId>()
  for (const link of links) {
    linkedByConversation.set(link.conversationId, link.ticketId)
    linkedTicketIds.add(link.ticketId)
  }
  const standaloneIds = ticketIds.filter((id) => !linkedTicketIds.has(id))

  // Linked pairs: agent messages on the conversation parent, newer than the
  // conversation's visitor watermark (null watermark == never read == all).
  if (linkedByConversation.size > 0) {
    const rows = await db
      .select({
        conversationId: conversationMessages.conversationId,
        c: sql<number>`count(*)::int`,
      })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
      .where(
        and(
          inArray(conversationMessages.conversationId, [...linkedByConversation.keys()]),
          eq(conversationMessages.senderType, 'agent'),
          isNull(conversationMessages.deletedAt),
          // Internal notes never count toward the requester's unread.
          eq(conversationMessages.isInternal, false),
          or(
            isNull(conversations.visitorLastReadAt),
            sql`${conversationMessages.createdAt} > ${conversations.visitorLastReadAt}`
          )
        )
      )
      .groupBy(conversationMessages.conversationId)
    for (const row of rows) {
      // The inner join on conversations guarantees a non-null conversation_id.
      const ticketId = linkedByConversation.get(row.conversationId as ConversationId)
      if (ticketId) map.set(ticketId, row.c)
    }
  }

  // Standalone tickets: the legacy ticket-parented count (mirrors
  // unreadCountForTicket's requester side, batched).
  if (standaloneIds.length > 0) {
    const rows = await db
      .select({
        ticketId: conversationMessages.ticketId,
        c: sql<number>`count(*)::int`,
      })
      .from(conversationMessages)
      .innerJoin(tickets, eq(tickets.id, conversationMessages.ticketId))
      .where(
        and(
          inArray(conversationMessages.ticketId, standaloneIds),
          eq(conversationMessages.senderType, 'agent'),
          isNull(conversationMessages.deletedAt),
          eq(conversationMessages.isInternal, false),
          or(
            isNull(tickets.requesterLastReadAt),
            sql`${conversationMessages.createdAt} > ${tickets.requesterLastReadAt}`
          )
        )
      )
      .groupBy(conversationMessages.ticketId)
    // The inner join on tickets guarantees a non-null ticket_id.
    for (const row of rows) map.set(row.ticketId as TicketId, row.c)
  }

  return map
}

/**
 * "Mark unread from here" for a ticket thread — the assignee-side sibling of
 * conversation.service.ts's `markConversationUnreadFromMessage`, against
 * `tickets.assigneeLastReadAt` instead of `conversations.agentLastReadAt`.
 * Deliberately a separate function (not a branch inside the conversation one):
 * the conversation-side fn is owned by a concurrent client integration this
 * task must not disturb.
 *
 * Agent-gated (`canActAsAgent` — only a team member can move their own read
 * watermark) and ticket-visibility-gated (`assertTicketVisible` — a
 * `ticket.view`-holding agent may only rewind a watermark on a ticket they can
 * actually see, not any ticket in the workspace); the anchor message must not
 * be soft-deleted. Reuses the shared, pure `unreadWatermarkFromAnchor`
 * (backward-only) so the date logic isn't duplicated between the conversation
 * and ticket domains. Published on the ticket channel as `ticket_read`
 * (unified inbox §3.2, M3) — the same event kind `markTicketReadForAgent`
 * already emits, so no new SSE contract.
 *
 * CONVERGENCE PHASE 1a: the pair-thread union loader (pair-thread.service.ts)
 * surfaces CONVERSATION-parented rows in the ticket thread, so the anchor an
 * agent picks can belong to the linked conversation rather than to the ticket.
 * Those rows fall back to the conversation's own unread mechanism — the pair's
 * watermark truth (ticket watermark columns retire for customer tickets under
 * convergence; they stay live for back-office/standalone threads, whose rows
 * are all ticket-parented and never reach the fallback). An anchor that
 * belongs to neither parent of the pair 404s exactly as before.
 */
export async function markTicketUnreadFromMessage(
  ticketId: TicketId,
  messageId: ConversationMessageId,
  actor: Actor
): Promise<void> {
  const ticket = await assertTicketVisible(ticketId, actor)
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)

  // The anchor lookup is parent-UNSCOPED: a union-sourced row hangs off the
  // pair's conversation, not the ticket (see the doc comment), so scoping by
  // ticket_id here would 404 a legitimate pick.
  const [message] = await db
    .select({
      createdAt: conversationMessages.createdAt,
      deletedAt: conversationMessages.deletedAt,
      ticketId: conversationMessages.ticketId,
      conversationId: conversationMessages.conversationId,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  if (!message || message.deletedAt) {
    throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  }

  if (message.ticketId !== ticketId) {
    // Conversation-parented anchor: valid only when it hangs off THIS ticket's
    // pair conversation — then the conversation watermark is the pair's truth
    // and its own mechanism moves it (it re-gates on canActAsAgent and
    // re-validates the anchor against the conversation; both already hold).
    const pairConversationId = await resolvePairConversationId(ticketId)
    if (message.conversationId && message.conversationId === pairConversationId) {
      const { markConversationUnreadFromMessage } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await markConversationUnreadFromMessage(message.conversationId, messageId, actor)
      return
    }
    throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  }

  const watermark = unreadWatermarkFromAnchor(ticket.assigneeLastReadAt, message.createdAt)
  await db.update(tickets).set({ assigneeLastReadAt: watermark }).where(eq(tickets.id, ticketId))
  publishTicketEvent(ticketId, {
    kind: 'ticket_read',
    ticketId,
    side: 'agent',
    at: (watermark ?? new Date(0)).toISOString(),
  })
}
