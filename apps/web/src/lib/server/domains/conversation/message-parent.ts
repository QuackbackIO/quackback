/** Public message actions accept conversation and ticket parents. Private
 * Copilot transcripts stay outside this boundary. */
import type { ConversationMessage } from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import type { Actor } from '@/lib/server/policy/types'

export type MessageParent =
  { kind: 'ticket'; ticketId: TicketId } | { kind: 'conversation'; conversationId: ConversationId }

/**
 * Resolve `message`'s parent. For a ticket-parented message, authorizes the
 * actor can see that ticket (§2.5) via `assertTicketVisible` — throwing
 * NotFound (never Forbidden) on an invisible parent, so a team member
 * without visibility on THIS ticket can't tell it exists. A
 * conversation-parented message gets no equivalent check here: a
 * pre-existing gap (callers today only re-check `canActAsAgent` plus the
 * flat `conversation.note` permission at the server-fn layer, or their own
 * conversation-level authz) that predates this helper — narrowing it further
 * is out of scope for this extraction.
 */
export async function resolveMessageParent(
  message: ConversationMessage,
  actor: Actor
): Promise<MessageParent> {
  if (message.workspaceThreadKey) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  if (message.ticketId) {
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(message.ticketId, actor)
    return { kind: 'ticket', ticketId: message.ticketId }
  }
  // A message has exactly one parent, so conversationId is guaranteed here.
  return { kind: 'conversation', conversationId: message.conversationId as ConversationId }
}
