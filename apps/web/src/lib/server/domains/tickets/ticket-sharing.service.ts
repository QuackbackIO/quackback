/**
 * Sharing a customer ticket with other customers. A customer ticket and its
 * conversation are one thread (convergence), so sharing the ticket is adding
 * the person as a participant of that conversation with `thread_access`: they
 * can then open the thread on the portal and in the widget, reply on it, and
 * follow it (a ticket_subscriptions row, reason 'participant', which carries
 * their notifications in the customer view). Removing them takes both away.
 *
 * Two ways in, with different rules:
 *
 * - A teammate shares with anyone by email (`ticket.reply` on a ticket they
 *   can see), the way the conversation's add-participant dialog adds a
 *   customer: an account by address, else a lead, else a new lead.
 * - The requester shares with a colleague: someone the workspace already has
 *   in the requester's own company. Company membership is set by the team, not
 *   claimed by the customer, so it is the trust boundary; the requester can
 *   neither add arbitrary addresses (no mail to strangers) nor learn whether an
 *   address exists (one answer for "unknown" and "not your colleague"). The
 *   requester removes the people they added; anyone can leave. That side, and
 *   what a customer sees of a ticket shared with them, is in
 *   customer-ticket-sharing.service.
 *
 * Only a customer ticket paired with a conversation can be shared: back-office
 * and tracker tickets have no customer thread.
 */
import {
  db,
  and,
  eq,
  inArray,
  isNull,
  conversationParticipants,
  principal,
  ticketSubscriptions,
  type Ticket,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { realEmail } from '@/lib/shared/anonymous-email'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import {
  addConversationParticipantByEmail,
  listConversationParticipants,
  removeConversationParticipant,
} from '@/lib/server/domains/conversation/conversation-participant.service'
import { assertTicketVisible } from './ticket.service'
import { resolvePairConversationId } from './pair-thread.service'
import { subscribeToTicket, unsubscribeFromTicket } from './ticket-subscription.service'
import { emitTicketSubscriberAdded, emitTicketSubscriberRemoved } from './ticket.webhooks'

/** The most customers one ticket can be shared with. */
export const MAX_TICKET_PARTICIPANTS = 20
/** A customer a ticket is shared with, as the team sees them. */
export interface TicketParticipant {
  principalId: PrincipalId
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  addedByPrincipalId: PrincipalId | null
}

/** The pair conversation a shareable ticket's thread lives on, or refuse. */
async function shareableConversation(ticket: Ticket): Promise<ConversationId> {
  const conversationId =
    ticket.type === 'customer' ? await resolvePairConversationId(ticket.id) : null
  if (!conversationId) {
    throw new ValidationError(
      'TICKET_NOT_SHAREABLE',
      'Only a customer ticket with a conversation thread can be shared'
    )
  }
  return conversationId
}

/** The customers a ticket's thread is shared with (thread access, not plain group-thread participants). */
export async function sharedParticipants(conversationId: ConversationId) {
  return (await listConversationParticipants(conversationId)).filter((p) => p.threadAccess)
}

/** Refuse a share past the per-ticket cap. */
export async function assertRoomFor(conversationId: ConversationId): Promise<void> {
  if ((await sharedParticipants(conversationId)).length >= MAX_TICKET_PARTICIPANTS) {
    throw new ValidationError(
      'TOO_MANY_PARTICIPANTS',
      `A ticket can be shared with up to ${MAX_TICKET_PARTICIPANTS} people`
    )
  }
}

/** Watch + announce a new participant; nothing to do when nothing changed. */
export async function afterShare(
  ticket: Ticket,
  principalId: PrincipalId,
  actor: Actor,
  actorName: string | null | undefined
): Promise<void> {
  if (await subscribeToTicket(principalId, ticket.id, 'participant')) {
    void emitTicketSubscriberAdded(actor, ticket, principalId, 'participant', actorName)
  }
}

/** Unwatch + announce a removed participant. */
export async function afterUnshare(ticket: Ticket, principalId: PrincipalId, actor: Actor) {
  const reason = await unsubscribeFromTicket(principalId, ticket.id)
  if (reason) void emitTicketSubscriberRemoved(actor, ticket, principalId, reason)
}

// ---------------------------------------------------------------------------
// The team side
// ---------------------------------------------------------------------------

async function assertTeamCanShare(ticketId: TicketId, actor: Actor): Promise<Ticket> {
  if (!can(actor, PERMISSIONS.TICKET_REPLY)) {
    throw new ForbiddenError('FORBIDDEN', 'You cannot share this ticket')
  }
  return assertTicketVisible(ticketId, actor)
}

/** The customers a ticket is shared with (team view, emails included). */
export async function listTicketParticipants(
  ticketId: TicketId,
  actor: Actor
): Promise<TicketParticipant[]> {
  if (!can(actor, PERMISSIONS.TICKET_VIEW)) {
    throw new ForbiddenError('FORBIDDEN', "You cannot see this ticket's participants")
  }
  const ticket = await assertTicketVisible(ticketId, actor)
  if (ticket.type !== 'customer') return []
  const conversationId = await resolvePairConversationId(ticket.id)
  if (!conversationId) return []
  return (await sharedParticipants(conversationId)).map((p) => ({
    principalId: p.principalId,
    displayName: p.displayName,
    email: p.email,
    avatarUrl: p.avatarUrl,
    addedByPrincipalId: p.addedByPrincipalId,
  }))
}

/**
 * A teammate shares a customer ticket with someone by email. Resolves the
 * address the way the conversation's add-participant dialog does (it may mint
 * a lead), never adds the requester to their own ticket, and refuses past the
 * per-ticket cap.
 */
export async function addTicketParticipantByEmail(
  ticketId: TicketId,
  email: string,
  actor: Actor,
  opts?: { actorDisplayName?: string | null }
): Promise<{ principalId: PrincipalId; added: boolean }> {
  const ticket = await assertTeamCanShare(ticketId, actor)
  const conversationId = await shareableConversation(ticket)
  await assertRoomFor(conversationId)
  const result = await addConversationParticipantByEmail(conversationId, email, actor, {
    actorDisplayName: opts?.actorDisplayName,
    threadAccess: true,
  })
  if (result.added) await afterShare(ticket, result.principalId, actor, opts?.actorDisplayName)
  return result
}

/** A teammate takes someone off a shared ticket (clean no-op otherwise). */
export async function removeTicketParticipant(
  ticketId: TicketId,
  principalId: PrincipalId,
  actor: Actor,
  opts?: { actorDisplayName?: string | null }
): Promise<{ removed: boolean }> {
  const ticket = await assertTeamCanShare(ticketId, actor)
  const conversationId = await shareableConversation(ticket)
  const { removed } = await removeConversationParticipant(conversationId, principalId, actor, opts)
  if (removed) await afterUnshare(ticket, principalId, actor)
  return { removed }
}

/**
 * The conversation dialog's add, when the conversation is a customer ticket's
 * thread: the same share as `addTicketParticipantByEmail` (thread access and a
 * watch), so the two ways in can never disagree. Null when the conversation
 * has no customer ticket, for the caller to add a plain participant instead.
 */
export async function shareConversationTicketByEmail(
  conversationId: ConversationId,
  email: string,
  actor: Actor,
  opts?: { actorDisplayName?: string | null }
): Promise<{ principalId: PrincipalId; added: boolean } | null> {
  const { resolvePairTicketIdForConversation } = await import('./pair-thread.service')
  const ticketId = await resolvePairTicketIdForConversation(conversationId)
  if (!ticketId) return null
  return addTicketParticipantByEmail(ticketId, email, actor, opts)
}

/** The conversation dialog's remove on a customer ticket's thread. */
export async function unshareConversationTicket(
  conversationId: ConversationId,
  principalId: PrincipalId,
  actor: Actor,
  opts?: { actorDisplayName?: string | null }
): Promise<{ removed: boolean } | null> {
  const { resolvePairTicketIdForConversation } = await import('./pair-thread.service')
  const ticketId = await resolvePairTicketIdForConversation(conversationId)
  if (!ticketId) return null
  return removeTicketParticipant(ticketId, principalId, actor, opts)
}

/**
 * When someone signs up with (or verifies) an address a ticket was shared
 * with, they get those tickets: the participant rows and watches of the lead
 * we minted for that address move to their new principal. Only a lead we
 * created from an address (anonymous, no account, that contact email) is
 * claimed, and only by a verified address, so signing up with someone else's
 * email claims nothing. Nothing else about the lead moves. A row the new
 * principal already has wins (the lead's is dropped), and gains the thread.
 */
export async function claimSharedTicketsForVerifiedEmail(
  principalId: PrincipalId,
  rawEmail: string
): Promise<{ claimed: number }> {
  const email = realEmail(rawEmail)?.trim().toLowerCase()
  if (!email) return { claimed: 0 }
  const leads = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        eq(principal.type, 'anonymous'),
        isNull(principal.userId),
        eq(principal.contactEmail, email)
      )
    )
  if (leads.length === 0) return { claimed: 0 }
  const leadIds = leads.map((l) => l.id)
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(conversationParticipants)
      .where(
        and(
          inArray(conversationParticipants.principalId, leadIds),
          eq(conversationParticipants.threadAccess, true)
        )
      )
    if (rows.length === 0) return { claimed: 0 }
    await tx
      .insert(conversationParticipants)
      .values(rows.map((r) => ({ ...r, principalId })))
      .onConflictDoNothing()
    // A copies-only row they already had on one of those threads gains the thread.
    await tx
      .update(conversationParticipants)
      .set({ threadAccess: true })
      .where(
        and(
          eq(conversationParticipants.principalId, principalId),
          inArray(
            conversationParticipants.conversationId,
            rows.map((r) => r.conversationId)
          )
        )
      )
    await tx
      .delete(conversationParticipants)
      .where(
        and(
          inArray(conversationParticipants.principalId, leadIds),
          eq(conversationParticipants.threadAccess, true)
        )
      )
    const watches = await tx
      .select()
      .from(ticketSubscriptions)
      .where(
        and(
          inArray(ticketSubscriptions.principalId, leadIds),
          eq(ticketSubscriptions.reason, 'participant')
        )
      )
    if (watches.length > 0) {
      await tx
        .insert(ticketSubscriptions)
        .values(
          watches.map((w) => ({
            ticketId: w.ticketId,
            principalId,
            reason: w.reason,
            mutedUntil: w.mutedUntil,
          }))
        )
        .onConflictDoNothing()
      await tx
        .delete(ticketSubscriptions)
        .where(
          and(
            inArray(ticketSubscriptions.principalId, leadIds),
            eq(ticketSubscriptions.reason, 'participant')
          )
        )
    }
    return { claimed: rows.length }
  })
}
