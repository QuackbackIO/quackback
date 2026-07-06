/**
 * Requester-facing ticket operations (support platform §4.2, 7C). A requester is
 * NOT a team agent, so every entry point here gates on OWNERSHIP — the actor is
 * the requester of a `customer` ticket — never on the agent `ticket.*`
 * permissions. Internal notes are stripped from the requester's thread, and a
 * requester reply posts as a customer-visible visitor message.
 */
import { db, tickets, eq, and, isNull, desc, type Ticket } from '@/lib/server/db'
import type { TicketId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import type { TiptapContent, ConversationAttachment } from '@/lib/shared/db-types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { NotFoundError, ForbiddenError } from '@/lib/shared/errors'
import { loadTicketOr404, createTicketCore, autoReopenOnRequesterReply } from './ticket.service'
import { emitTicketReplied } from './ticket.webhooks'
import { buildTicketContext, ticketToDTO } from './ticket.dto'
import {
  insertTicketMessage,
  listTicketMessages,
  type SendTicketMessageInput,
  type TicketMessagePage,
} from './ticket-message.service'
import type { TicketDTO } from './ticket.types'

const LIST_LIMIT = 100

/** The signed-in requester's principal id, or refuse. */
function requireRequester(actor: Actor): PrincipalId {
  if (!actor.principalId) throw new ForbiddenError('FORBIDDEN', 'You must be signed in')
  return actor.principalId
}

/**
 * Load a ticket the actor owns as its requester, or 404. A requester only ever
 * sees their own `customer` tickets; anything else 404s so existence never leaks.
 */
async function loadOwnedTicketOr404(ticketId: TicketId, principalId: PrincipalId): Promise<Ticket> {
  const ticket = await loadTicketOr404(ticketId)
  if (ticket.type !== 'customer' || ticket.requesterPrincipalId !== principalId) {
    throw new NotFoundError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found`)
  }
  return ticket
}

/** Every `customer` ticket the actor filed, newest activity first. */
export async function listMyTickets(actor: Actor): Promise<TicketDTO[]> {
  const principalId = requireRequester(actor)
  const rows = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.requesterPrincipalId, principalId),
        eq(tickets.type, 'customer'),
        isNull(tickets.deletedAt)
      )
    )
    .orderBy(desc(tickets.updatedAt), desc(tickets.id))
    .limit(LIST_LIMIT)
  const ctx = await buildTicketContext(rows)
  return rows.map((r) => ticketToDTO(r, ctx))
}

/** A single ticket the actor owns as requester. */
export async function getMyTicket(actor: Actor, ticketId: TicketId): Promise<TicketDTO> {
  const principalId = requireRequester(actor)
  const ticket = await loadOwnedTicketOr404(ticketId, principalId)
  const ctx = await buildTicketContext([ticket])
  return ticketToDTO(ticket, ctx)
}

/** The customer-visible thread of a ticket the actor owns (internal notes stripped). */
export async function getMyTicketThread(
  actor: Actor,
  ticketId: TicketId,
  opts: { before?: string } = {}
): Promise<TicketMessagePage> {
  const principalId = requireRequester(actor)
  await loadOwnedTicketOr404(ticketId, principalId)
  return listTicketMessages(ticketId, { before: opts.before, includeInternal: false })
}

/**
 * The requester opens their own ticket. Forced to the `customer` type and to the
 * caller as requester, so it can never file for someone else or raise an internal
 * type. The opt-in enablement (support tickets on) is gated at the fn layer.
 */
export async function createMyTicket(
  actor: Actor,
  input: {
    title: string
    description?: string
    descriptionJson?: TiptapContent | null
    attachments?: ConversationAttachment[]
  }
): Promise<TicketDTO> {
  const principalId = requireRequester(actor)
  return createTicketCore(
    {
      type: 'customer',
      title: input.title,
      description: input.description,
      descriptionJson: input.descriptionJson,
      attachments: input.attachments,
      requesterPrincipalId: principalId,
    },
    actor
  )
}

/** The requester replies on their own ticket thread (a customer-visible message). */
export async function replyToMyTicket(
  actor: Actor,
  input: SendTicketMessageInput
): Promise<{ message: ConversationMessageDTO }> {
  const principalId = requireRequester(actor)
  await loadOwnedTicketOr404(input.ticketId, principalId)
  const { message, ticket } = await insertTicketMessage(input, principalId, {
    senderType: 'visitor',
    isInternal: false,
    // A requester reply is not an agent "first response".
    stampFirstResponse: false,
  })
  // A reply from a waiting/closed requester reopens the ticket (§4.2).
  await autoReopenOnRequesterReply(input.ticketId)
  // Agent/integration-facing signal (senderType 'visitor'): customer activity
  // the team's integrations want, fire-and-forget after the write commits.
  void emitTicketReplied(actor, ticket, message)
  return { message }
}
