/**
 * Ticket side effects driven off the shared event bus (convergence Phase 1a —
 * scratchpad/convergence-design.md, second-opinion dealbreaker 3). Same
 * lazy-import pattern as sla.event-hooks.ts: the event reactions
 * (events/event-reactions.ts) route every `message.created` here, the hook
 * swallows its own errors, and the pure-DB recorders never re-enter the bus.
 *
 * Today exactly one reaction lives here: a VISITOR `message.created` on a
 * conversation paired with a CUSTOMER ticket reopens that ticket
 * (`autoReopenOnRequesterReply`). Without it a Messenger reply on the
 * conversation would leave the ticket stuck in "Waiting on customer" — the
 * exact incoherence convergence exists to kill (the portal/widget reply path
 * already reopens directly; this hook covers the conversation-native channels
 * and is idempotent against the direct call).
 *
 * LOOP SAFETY: the reopen emits `ticket.status_changed`, never
 * `message.created` (system stage notices — re-parented to the conversation or
 * not — are author-less inserts that dispatch nothing), so this hook can never
 * re-trigger itself; the recorders it calls are status-guarded no-ops when the
 * ticket is already open.
 */
import {
  db,
  conversations,
  tickets,
  ticketStatuses,
  ticketActivity,
  eq,
  and,
  isNull,
  asc,
  type Ticket,
} from '@/lib/server/db'
import type { EventData } from '@/lib/server/events/types'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { logger } from '@/lib/server/logger'
import { autoReopenOnRequesterReply } from './ticket.service'
import { resolvePairTicketIdForConversation } from './pair-thread.service'
import { statusMovedSince } from './ticket-activity.service'
import { statusTransition, resolveStage } from './ticket.lifecycle'
import { publishTicketUpdated } from './ticket-intake.service'
import { emitTicketStatusChanged } from './ticket.webhooks'

const log = logger.child({ component: 'ticket-event-hooks' })

/**
 * Reopen the customer ticket paired with `message.created`'s conversation, if
 * any. The pair is 1:1 (the conversation side is unique by 0150's
 * `ticket_conversations_customer_uq`), so at most one ticket ever matches.
 * Agent/system messages and pair-less conversations return immediately.
 */
export async function autoReopenPairTicketFromEvent(event: EventData): Promise<void> {
  try {
    if (event.type !== 'message.created') return
    if (event.data.message.senderType !== 'visitor') return
    const conversationId = event.data.message.conversationId as ConversationId
    const ticketId = await resolvePairTicketIdForConversation(conversationId)
    if (!ticketId) return
    // The message author is the requester — threaded through so the reopen's
    // timeline record + event actor attribute the move to them (the function
    // no-ops unless the ticket is awaiting them or closed, so an already-open
    // ticket — e.g. the portal reply path's direct call having landed first —
    // records nothing twice). The message's own time lets a reaction that runs
    // late leave standing a close made after the message.
    const messageAt = new Date(event.data.message.createdAt)
    await autoReopenOnRequesterReply(
      ticketId,
      (event.data.message.authorPrincipalId as PrincipalId | null) ?? null,
      Number.isNaN(messageAt.getTime()) ? null : messageAt
    )
  } catch (err) {
    log.error({ err, eventType: event.type }, 'pair-ticket auto-reopen failed')
  }
}

/**
 * Resolve an open or pending customer ticket when its paired conversation is
 * closed (non-spam). Mirrors `autoReopenOnRequesterReply`:
 * - skips if the conversation was reopened since the close event or ended as
 *   spam (`endReason === 'spam'`);
 * - skips if the ticket is already in a `closed` status category or had its
 *   status moved after `closedAt`;
 * - transitions to the workspace's resolved (`category = 'closed'`, preferring
 *   `publicStage = 'resolved'`) status, stamping `resolvedAt`, recording
 *   `status.changed`, publishing `ticket_updated`, and emitting
 *   `ticket.status_changed` (never `conversation.status_changed`, so it is
 *   loop-free).
 */
export async function autoResolveOnConversationClose(
  id: TicketId,
  conversationId: ConversationId,
  byPrincipalId: PrincipalId | null = null,
  closedAt: Date | null = null
): Promise<boolean> {
  const [conv] = await db
    .select({ status: conversations.status, endReason: conversations.endReason })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conv || conv.status !== 'closed' || conv.endReason === 'spam') return false

  const [existing] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
    .limit(1)
  if (!existing) return false

  const [current] = await db
    .select({
      name: ticketStatuses.name,
      category: ticketStatuses.category,
      publicStage: ticketStatuses.publicStage,
    })
    .from(ticketStatuses)
    .where(eq(ticketStatuses.id, existing.statusId))
    .limit(1)
  if (!current || current.category === 'closed') return false
  if (closedAt && (await statusMovedSince(id, closedAt))) return false

  const closedStatuses = await db
    .select({
      id: ticketStatuses.id,
      name: ticketStatuses.name,
      publicStage: ticketStatuses.publicStage,
    })
    .from(ticketStatuses)
    .where(and(eq(ticketStatuses.category, 'closed'), isNull(ticketStatuses.deletedAt)))
    .orderBy(asc(ticketStatuses.position))
  const target =
    closedStatuses.find((s) => s.publicStage === 'resolved') ?? closedStatuses[0] ?? null
  if (!target || target.id === existing.statusId) return false

  const now = new Date()
  const transition = statusTransition(current.category, 'closed', now)
  const patch: Partial<Ticket> = { statusId: target.id, updatedAt: now }
  if (transition.resolvedAt !== undefined) patch.resolvedAt = transition.resolvedAt

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tickets)
      .set(patch)
      .where(and(eq(tickets.id, id), eq(tickets.statusId, existing.statusId)))
      .returning()
    if (!row) return null
    await tx.insert(ticketActivity).values({
      ticketId: id,
      principalId: byPrincipalId,
      type: 'status.changed',
      metadata: {
        fromId: existing.statusId,
        fromName: current.name,
        toId: target.id,
        toName: target.name,
        trigger: 'conversation_closed',
      },
    })
    return row
  })
  if (!updated) return false

  await publishTicketUpdated(updated)

  const previousStage = resolveStage(current)
  const newStage = resolveStage(target)
  const actor: Actor = {
    principalId: byPrincipalId,
    role: 'admin',
    principalType: byPrincipalId ? 'user' : 'service',
    segmentIds: new Set(),
  }
  void emitTicketStatusChanged(
    actor,
    updated,
    current.category,
    'closed',
    newStage,
    previousStage,
    existing.requesterPrincipalId ?? null
  )
  return true
}

/**
 * Resolve the customer ticket paired with `conversation.status_changed`'s
 * conversation when it transitions into `closed`.
 */
export async function autoResolvePairTicketFromEvent(event: EventData): Promise<void> {
  try {
    if (event.type !== 'conversation.status_changed') return
    if (event.data.newStatus !== 'closed' || event.data.previousStatus === 'closed') return
    const conversationId = event.data.conversation.id as ConversationId
    const ticketId = await resolvePairTicketIdForConversation(conversationId)
    if (!ticketId) return
    const closedAt = new Date(event.timestamp)
    await autoResolveOnConversationClose(
      ticketId,
      conversationId,
      (event.actor?.principalId as PrincipalId | null) ?? null,
      Number.isNaN(closedAt.getTime()) ? null : closedAt
    )
  } catch (err) {
    log.error({ err, eventType: event.type }, 'pair-ticket auto-resolve failed')
  }
}
