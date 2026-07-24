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
 * back-office/tracker tickets, which kept their own ticket-scoped threads —
 * post-0218 (Phase 6) every requester-holding customer ticket is a pair, so
 * the only standalone customer tickets left are the inert no-requester legacy
 * edge. Unread COUNTS for a linked pair likewise read the conversation
 * watermark (the Messages surface's conversation badges — the requester-side
 * ticket count retired with the converged surface; conversation unreads are
 * the complete requester truth by construction).
 *
 * CONVERGENCE PHASE 3 — WRITER CLEANUP COMPLETE: nothing writes the legacy
 * ticket watermark columns for a linked customer ticket anymore. The one
 * remaining writer Phase 2 left behind — `markTicketUnreadFromMessage` with a
 * legacy ticket-parented anchor on a pair — now moves the CONVERSATION's agent
 * watermark instead. The columns are legacy-READ only on the customer axis
 * (a pair's frozen pre-link values are simply never consulted) and remain
 * live for back-office/tracker.
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
  sql,
} from '@/lib/server/db'
import type { TicketId, ConversationMessageId } from '@quackback/ids'
import { publishTicketEvent } from '@/lib/server/realtime/conversation-channels'
import { unreadWatermarkFromAnchor } from '@/lib/server/domains/conversation/conversation.lifecycle'
import { assertTicketVisible } from './ticket.service'
import { resolvePairConversationId } from './pair-thread.service'
import { canActAsAgent } from '@/lib/server/policy/conversation'
import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError, ForbiddenError } from '@/lib/shared/errors'

/**
 * Batched requester-authored unread count for a page of tickets, for list
 * enrichment (mirrors conversation.query.ts's listConversationsForAgent
 * unread-rows query). Only tickets with at least one unread message appear in
 * the returned map.
 *
 * SINGLE-PARENT SCOPE (justified, CONVERGENCE PHASE 3): the count reads
 * ticket-parented rows against `tickets.assigneeLastReadAt`, which is the
 * watermark truth ONLY for unlinked threads. The one production caller — the
 * unified inbox's ticket branch (inbox.query.ts's fetchTicketBranch) — passes
 * `excludeConversationLinked: true`, so a linked customer pair never reaches
 * this query (it lists as its conversation row, whose badge reads
 * `conversations.agentLastReadAt`). Do not reuse this for a page that can
 * contain linked pairs.
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
        // (visitor messages are never internal anyway).
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

/** Mark a ticket read for the assignee (agent) side. Publishes a
 *  'ticket_read' (unified inbox §3.2, M3) so another tab/teammate's open
 *  thread or inbox list clears the badge live.
 *
 *  Read-through: on a linked customer pair the conversation's watermark is
 *  the pair's truth, so the write delegates to the conversation's own
 *  mark-read (which writes `conversations.agent_last_read_at` and publishes
 *  the conversation 'read' event) instead of touching the legacy ticket
 *  columns. The ticket column keeps being written ONLY for unlinked threads —
 *  back-office/tracker tickets, which kept their own ticket-scoped thread.
 *  (The requester side needs no sibling: the requester reads their pair
 *  through the conversation surface directly.) */
export async function markTicketReadForAgent(ticketId: TicketId, actor: Actor): Promise<void> {
  const pairConversationId = await resolvePairConversationId(ticketId)
  if (pairConversationId) {
    const { markConversationRead } =
      await import('@/lib/server/domains/conversation/conversation.service')
    await markConversationRead(pairConversationId, actor)
    return
  }
  const at = new Date()
  await db.update(tickets).set({ assigneeLastReadAt: at }).where(eq(tickets.id, ticketId))
  publishTicketEvent(ticketId, {
    kind: 'ticket_read',
    ticketId,
    side: 'agent',
    at: at.toISOString(),
  })
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
 * watermark truth. CONVERGENCE PHASE 3: a LEGACY ticket-parented anchor on a
 * linked pair now moves the conversation's agent watermark too (via
 * `markConversationUnreadAt`) — the ticket watermark columns are legacy-read
 * only for customer tickets, so writing one would move nothing any reader
 * consults. The ticket-column write below therefore remains ONLY for unlinked
 * threads — back-office/tracker tickets, whose rows are all ticket-parented
 * (post-0218 the only standalone customer tickets are the inert no-requester
 * legacy edge). An anchor that belongs to neither parent of the pair 404s
 * exactly as before.
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

  // LEGACY ticket-parented anchor. CONVERGENCE PHASE 3: on a LINKED customer
  // pair the ticket watermark columns are legacy-read only — the pair's truth
  // is the conversation's agent watermark — so "unread from here" moves THAT
  // watermark to just before the anchor instead of writing the retired column
  // (which no reader of a pair consults anymore). The ticket-column write
  // below stays live ONLY for unlinked threads — back-office/tracker tickets,
  // which kept their own ticket-scoped thread (post-0218 the only standalone
  // customer tickets are the inert no-requester legacy edge).
  const pairConversationId = await resolvePairConversationId(ticketId)
  if (pairConversationId) {
    const { markConversationUnreadAt } =
      await import('@/lib/server/domains/conversation/conversation.service')
    await markConversationUnreadAt(pairConversationId, message.createdAt, actor)
    return
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
