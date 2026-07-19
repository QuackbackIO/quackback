/**
 * Link a ticket to the conversation it was created from (unified inbox §M5's
 * create-ticket flow): inserts the `ticket_conversations` join row, announces
 * the ticket on the conversation thread as a system event (mirrors
 * ticket-links.service.ts's tracker-link note, but on the CONVERSATION side —
 * `emitSystemMessage`'s content is agent-facing plain English, never sent to
 * the customer), and lets that same insert/publish keep any open inbox tab in
 * sync. Customer tickets only: the partial-unique index
 * (`ticket_conversations_customer_uq`) allows at most one CUSTOMER ticket per
 * conversation, surfaced here as a friendly `ConflictError` instead of a raw
 * constraint violation should two teammates race to link the same
 * conversation.
 *
 * SLA handoff (support platform §4.6, "applied first time" semantics): when
 * the conversation has an active SLA whose policy tracks time-to-resolve, the
 * freshly linked ticket starts its OWN TTR clock under that same policy,
 * ticking from the LINK instant (not the ticket's creation — the row may
 * precede the link by a dialog's worth of drafting). Best-effort like the
 * announcement: the link already landed, so a handoff failure is logged,
 * never surfaced to the caller.
 */
import { db, eq, conversations, ticketConversations } from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError, ValidationError, ConflictError, NotFoundError } from '@/lib/shared/errors'
import { isUniqueViolation } from '@/lib/server/utils'
import { formatTicketNumber } from '@/lib/shared/tickets'
import { logger } from '@/lib/server/logger'
import { loadTicketOr404 } from './ticket.service'
import { loadSlaApplied } from '../sla/sla.service'
import { applySlaToTicket } from '../sla/ticket-sla.service'

const log = logger.child({ component: 'ticket-conversation-link' })

/**
 * Link `ticketId` (must be type 'customer') to `conversationId`. Gated on
 * `ticket.create` — this is only ever called as the second step of the
 * create-ticket flow (createTicketFn then linkTicketToConversationFn), never
 * as a standalone re-link action.
 */
export async function linkTicketToConversation(
  ticketId: TicketId,
  conversationId: ConversationId,
  actor: Actor
): Promise<void> {
  if (!can(actor, PERMISSIONS.TICKET_CREATE)) {
    throw new ForbiddenError('FORBIDDEN', 'You cannot link a ticket to a conversation')
  }

  const ticket = await loadTicketOr404(ticketId)
  if (ticket.type !== 'customer') {
    throw new ValidationError(
      'INVALID_LINK',
      'Only customer tickets can be linked to a conversation'
    )
  }

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conversation) {
    throw new NotFoundError('NOT_FOUND', 'Conversation not found')
  }

  try {
    await db.insert(ticketConversations).values({
      ticketId,
      conversationId,
      ticketType: 'customer',
      linkedByPrincipalId: actor.principalId ?? null,
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError('ALREADY_LINKED', 'This conversation already has a linked ticket')
    }
    throw err
  }

  // Best-effort announcement: the link itself already landed, so a failure
  // here (e.g. the conversation was deleted a moment later) must not surface
  // as an error to the caller — emitSystemMessage already swallows its own.
  const { emitSystemMessage } =
    await import('@/lib/server/domains/conversation/conversation.service')
  const reference = formatTicketNumber(ticket.number)
  await emitSystemMessage(conversationId, `Ticket ${reference} created from this conversation`, {
    kind: 'ticket_created',
    ticketReference: reference,
  })

  // SLA handoff (see the module doc): start the linked ticket's TTR clock
  // under the conversation's active policy. Only ever fires for the customer
  // ticket this function accepts — a back-office/tracker ticket can never be
  // conversation-linked through here (the type guard above rejects them), so
  // there is no non-customer branch to skip. A conversation with no SLA skips
  // silently; a policy without a TTR target no-ops inside applySlaToTicket,
  // which keeps the "does this policy even track TTR" check in ONE place
  // rather than duplicated here. Best-effort: the link already landed.
  try {
    const slaApplied = await loadSlaApplied(conversationId)
    if (slaApplied) {
      const applied = await applySlaToTicket(ticketId, slaApplied.policyId)
      if (applied) {
        log.info(
          { ticket_id: ticketId, conversation_id: conversationId, policy_id: applied.policyId },
          'ticket TTR clock started from conversation SLA handoff'
        )
      }
    }
  } catch (err) {
    log.warn(
      { err, ticket_id: ticketId, conversation_id: conversationId },
      'ticket SLA handoff failed (link already landed)'
    )
  }

  log.info(
    { ticket_id: ticketId, conversation_id: conversationId },
    'ticket linked to conversation'
  )
}
