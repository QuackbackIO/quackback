/**
 * Link a ticket to the conversation it was created from (unified inbox §M5's
 * create-ticket flow): inserts the `ticket_conversations` join row, announces
 * the ticket on the conversation thread as a system event (mirrors
 * ticket-links.service.ts's tracker-link note, but on the CONVERSATION side),
 * and lets that same insert/publish keep any open inbox tab in sync.
 *
 * TWO KINDS OF LINK, one join row. A CUSTOMER ticket linked to a conversation
 * IS that conversation (the convergence pair): the two are one item, share a
 * thread, and every pair reader keys off `ticket_type = 'customer'`. Any other
 * type (a back-office task spun off the conversation, a tracker) links as
 * PROVENANCE only — the conversation it came from, kept — and the pair
 * semantics below stay switched off for it. `ticket_type` is denormalized from
 * the ticket at link time so both the partial uniques and every reader can
 * tell the two apart without a join.
 *
 * AUDIENCE (B17, decided with the convergence). For the pair the announcement
 * is for BOTH sides: on the converged shared thread it is the in-thread
 * conversion marker — the conversation's visitor IS the ticket's requester, so
 * "Ticket #N created from this conversation" tells them where their thread
 * went. Customer-facing clients (messenger, portal/widget ticket threads)
 * therefore LOCALIZE it from `metadata.systemEvent` (`kind: 'ticket_created'` +
 * `ticketReference`) via SystemEventNotice; the stored English `content` is
 * only the fallback for agent surfaces, email transcripts, and legacy/
 * unknown-kind rendering — never the display string a customer sees. A
 * provenance link announces TEAM-ONLY instead: internal work is never the
 * customer's business, and nothing about their own thread has changed.
 *
 * The pair is 1:1 (convergence Phase 0): the partial-unique indexes
 * (`ticket_conversations_customer_uq`, `ticket_conversations_customer_ticket_uq`)
 * allow at most one CUSTOMER ticket per conversation AND at most one
 * conversation per CUSTOMER ticket — a violation of either surfaces here as a
 * friendly `ConflictError` instead of a raw constraint violation should two
 * teammates race to link the same conversation or ticket. Both indexes are
 * partial, so provenance links are free-form: several per conversation, several
 * per ticket, and one repeated pair trips only the composite primary key, which
 * reads as the same friendly conflict.
 *
 * SLA handoff (support platform §4.6, "applied first time" semantics): when
 * the conversation has an active SLA whose policy tracks time-to-resolve, the
 * freshly linked CUSTOMER ticket starts its OWN TTR clock under that same
 * policy, ticking from the LINK instant (not the ticket's creation — the row
 * may precede the link by a dialog's worth of drafting). Best-effort like the
 * announcement: the link already landed, so a handoff failure is logged,
 * never surfaced to the caller. A provenance link hands nothing over: the
 * conversation still owns the customer promise, and a second clock on an
 * internal task would measure that promise against work the customer never
 * asked for.
 *
 * A NOTE CAN BE SENT BACK ALONG A PROVENANCE LINK (`crossPostTicketNote`).
 * Keeping the originating conversation is only half of what makes a spun-off
 * task useful: the teammate who later reads that conversation needs to know
 * what came of the task. So an internal note on a provenance-linked ticket can
 * be carried onto each conversation it was opened from, as an internal note of
 * its own — a per-note choice its author makes, never the default, since a
 * back-office thread is mostly the specialist's own working chatter and the
 * conversation is the customer's record. The pair is excluded — a customer
 * ticket and its conversation are one thread through the union read, so a
 * carried copy would show twice — and every carried note is stamped with its
 * origin ticket, which is what stops a note travelling in circles.
 */
import {
  db,
  eq,
  ne,
  and,
  asc,
  isNull,
  conversations,
  conversationMessages,
  ticketConversations,
  tickets,
  type Ticket,
  type ConversationMessageMetadata,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError, ConflictError, NotFoundError } from '@/lib/shared/errors'
import { isUniqueViolation } from '@/lib/server/utils'
import { formatTicketNumber } from '@/lib/shared/tickets'
import { logger } from '@/lib/server/logger'
import { loadTicketOr404 } from './ticket.service'
import { loadSlaApplied } from '../sla/sla.service'
import { applySlaToTicket } from '../sla/ticket-sla.service'

const log = logger.child({ component: 'ticket-conversation-link' })

/**
 * Link `ticketId` to `conversationId`. Gated on `ticket.create` — this is only
 * ever called as the second step of the create-ticket flow (createTicketFn
 * then linkTicketToConversationFn), never as a standalone re-link action. A
 * customer ticket links as the conversation's PAIR (see the module doc); any
 * other type links as provenance, which is the join row and a team-only note
 * and nothing else.
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
  // The pair rule keys off the ticket's own type — everything below that says
  // "the conversation and the ticket are one" is gated on it.
  const isPair = ticket.type === 'customer'

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
      // Denormalized from the ticket so the partial uniques and every pair
      // reader can tell a pair from provenance without a join.
      ticketType: ticket.type,
      linkedByPrincipalId: actor.principalId ?? null,
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Three constraints can fire: the two partial uniques guarding the 1:1
      // pair (see the module doc) and the composite primary key, the only one
      // a provenance link can trip. Discriminate which. Drizzle wraps the
      // driver error; the pg fields live on `cause`, and the driver may expose
      // the violated index as `constraint`, `constraint_name`, or only in the
      // `detail` text (same idiom as company.service's translateUniqueError).
      const pgErr = (err as { cause?: unknown }).cause ?? err
      const e = pgErr as { constraint?: string; constraint_name?: string; detail?: string }
      const marker = `${e.constraint ?? ''} ${e.constraint_name ?? ''} ${e.detail ?? ''}`
      if (marker.includes('ticket_conversations_pkey')) {
        throw new ConflictError(
          'ALREADY_LINKED',
          'This ticket is already linked to this conversation'
        )
      }
      if (marker.includes('ticket_conversations_customer_ticket_uq')) {
        throw new ConflictError('ALREADY_LINKED', 'This ticket is already linked to a conversation')
      }
      throw new ConflictError('ALREADY_LINKED', 'This conversation already has a linked ticket')
    }
    throw err
  }

  // CONVERGENCE PHASE 1a firstResponseAt rule (convergence-design.md,
  // mechanics appendix "Write (Phase 1)"): when the ticket has no
  // first_response_at yet and the conversation already carries an agent reply,
  // backfill the ticket's column from the conversation's FIRST agent message —
  // the response happened before the pair existed, and the ticket's timeline
  // must not pretend otherwise. After the link, the conversation's
  // first-response machinery owns the timeline (the Phase 1a write redirect
  // never stamps the ticket's column). Internal notes don't count as a
  // response, mirroring insertTicketMessage's stamp rule; senderType 'agent'
  // includes Quinn's replies, matching the conversation SLA's own FRT settle.
  // Pair-only: on a provenance link the conversation's replies answered the
  // CUSTOMER, and an internal task's response clock is its own.
  if (isPair && !ticket.firstResponseAt) {
    const [firstAgentMessage] = await db
      .select({ createdAt: conversationMessages.createdAt })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversationId),
          eq(conversationMessages.senderType, 'agent'),
          eq(conversationMessages.isInternal, false),
          isNull(conversationMessages.deletedAt)
        )
      )
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
      .limit(1)
    if (firstAgentMessage) {
      await db
        .update(tickets)
        .set({ firstResponseAt: firstAgentMessage.createdAt })
        .where(eq(tickets.id, ticketId))
    }
  }

  // Best-effort announcement: the link itself already landed, so a failure
  // here (e.g. the conversation was deleted a moment later) must not surface
  // as an error to the caller — emitSystemMessage already swallows its own.
  // The pair's conversion marker is customer-visible (the visitor IS the
  // requester); provenance is a team-only note, since the customer's thread
  // has not moved and the internal task is not theirs to see.
  const { emitSystemMessage } =
    await import('@/lib/server/domains/conversation/conversation.service')
  const reference = formatTicketNumber(ticket.number)
  await emitSystemMessage(
    conversationId,
    isPair
      ? `Ticket ${reference} created from this conversation`
      : `Internal ticket ${reference} opened from this conversation`,
    { kind: 'ticket_created', ticketReference: reference },
    { internal: !isPair }
  )

  // SLA handoff (see the module doc): start the linked ticket's TTR clock
  // under the conversation's active policy. Pair-only — the conversation keeps
  // the customer promise when the link is provenance, so there is nothing to
  // hand over. Best-effort: the link already landed.
  if (isPair) await handoffConversationSlaToTicket(ticketId, conversationId)

  log.info(
    { ticket_id: ticketId, conversation_id: conversationId, ticket_type: ticket.type },
    'ticket linked to conversation'
  )
}

/**
 * The conversations a ticket links to as PROVENANCE — the ones it was opened
 * from. The customer pair is excluded by the `ticket_type` predicate, the same
 * denormalized column every pair reader keys off; provenance links are
 * free-form, so a ticket may carry several.
 */
export async function resolveProvenanceConversationIds(
  ticketId: TicketId
): Promise<ConversationId[]> {
  const links = await db
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        ne(ticketConversations.ticketType, 'customer')
      )
    )
  return links.map((link) => link.conversationId)
}

/**
 * Carry a ticket's internal note back along its provenance links, on its
 * author's explicit ask (`addTicketNote`'s `shareWithConversation` — a note is
 * the ticket's own until someone decides otherwise). The note lands on each
 * conversation the ticket was opened from as an internal note of
 * its own, authored by the same teammate, written through the conversation
 * domain's own note path (`addAgentNote`) so it gets the whole note pipeline —
 * the updatedAt touch, the agent-channel broadcast, the note event — rather
 * than a bare row insert. The note itself never moves: the ticket thread stays
 * its home, and the conversation gets a copy that names the ticket it came
 * from.
 *
 * PAIR EXCLUSION. A customer ticket's notes are never carried. The pair is one
 * thread already (pair-thread.service's union read serves both parents), so a
 * copy there would show the note twice.
 *
 * LOOP SAFETY. Every carried copy is stamped `crossPostedFromTicketId`, and a
 * note that already carries the stamp is never carried again — the stamp
 * outranks the ask, since sharing is a choice a human makes about an original
 * and not a licence the copy inherits. A copy that finds its way back onto a
 * ticket thread — a relay, an integration replaying it, either of them asking
 * to share as eagerly as the note it echoes — therefore lands once and stops,
 * instead of the two threads bouncing it between them.
 *
 * Best-effort per conversation, like the link announcement: the note has
 * already landed on the ticket, so a copy that fails (the conversation was
 * deleted, the author may note tickets but not act as an agent on
 * conversations) is logged, never surfaced to the caller.
 */
export async function crossPostTicketNote(
  ticket: Ticket,
  note: {
    content: string
    authorPrincipalId: PrincipalId
    metadata?: ConversationMessageMetadata
  },
  actor: Actor
): Promise<void> {
  if (ticket.type === 'customer') return
  if (note.metadata?.crossPostedFromTicketId) return
  const conversationIds = await resolveProvenanceConversationIds(ticket.id)
  if (conversationIds.length === 0) return

  // Dynamic, the same precedent the link announcement sets: the conversation
  // domain imports nothing from this one, and the lazy edge keeps it that way.
  const { addAgentNote } = await import('@/lib/server/domains/conversation/conversation.service')
  const reference = formatTicketNumber(ticket.number)
  for (const conversationId of conversationIds) {
    try {
      await addAgentNote(
        conversationId,
        `Note on internal ticket ${reference}: ${note.content}`,
        { principalId: note.authorPrincipalId },
        actor,
        // Plain text: the copy is an echo for context, and the ticket thread
        // keeps the note's full fidelity (rich doc, mentions, attachments).
        null,
        undefined,
        { crossPostedFromTicketId: ticket.id }
      )
    } catch (err) {
      log.warn(
        { err, ticket_id: ticket.id, conversation_id: conversationId },
        'ticket note cross-post failed (note already landed)'
      )
    }
  }
}

/**
 * The SLA handoff itself (support platform §4.6, "applied first time"
 * semantics): when the conversation has an active SLA whose policy tracks
 * time-to-resolve, the ticket starts its OWN TTR clock under that same policy,
 * ticking from the LINK instant. Shared by `linkTicketToConversation` (the
 * create-from-a-conversation flow) and the Phase 1b intake transaction
 * (`createTicketCore`'s backing-conversation path) so the handoff rule lives
 * in ONE place — a conversation with no SLA skips silently (the intake case:
 * a fresh backing conversation is born SLA-free, so this is a no-op there by
 * construction, and the same-TICKET handoff later fires off the conversation's
 * own SLA application), and a policy without a TTR target no-ops inside
 * applySlaToTicket, which keeps the "does this policy even track TTR" check in
 * ONE place rather than duplicated at the call sites. Best-effort: the link
 * already landed, so a failure is logged, never surfaced.
 */
export async function handoffConversationSlaToTicket(
  ticketId: TicketId,
  conversationId: ConversationId
): Promise<void> {
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
}
