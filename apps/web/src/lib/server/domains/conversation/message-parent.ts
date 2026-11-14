/** Public message actions accept conversation and ticket parents. Private
 * Copilot transcripts stay outside this boundary. */
import type { Conversation, ConversationMessage } from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import { NotFoundError, isNotFoundError } from '@/lib/shared/errors'
import type { Actor } from '@/lib/server/policy/types'
import { assertConversationVisible, loadConversationOr404 } from './conversation-visibility'

export type MessageParent =
  | { kind: 'ticket'; ticketId: TicketId }
  | {
      kind: 'conversation'
      conversationId: ConversationId
      conversation: Conversation
      /** Set when the message was admitted as the pair of a visible customer
       *  ticket: the actor acts on it through the ticket, with ticket keys. */
      via?: 'pair'
    }

/** Which thread's permissions apply to a message: a pair-admitted message is
 *  acted on through its ticket. */
export function permissionParentOf(parent: MessageParent): 'conversation' | 'ticket' {
  return parent.kind === 'ticket' || parent.via === 'pair' ? 'ticket' : 'conversation'
}

/**
 * Resolve `message`'s parent and check that the actor can see it: the ticket
 * through `assertTicketVisible`, the conversation through
 * `assertConversationVisible`. A conversation the actor cannot see is still
 * admitted when it is the pair of a customer ticket they can see: the ticket
 * thread shows that conversation's messages, and its actions must work there
 * too. A parent the actor cannot see throws NotFound (never Forbidden), so a
 * teammate outside its scope can't tell it exists.
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
  const conversationId = message.conversationId as ConversationId
  try {
    const conversation = await assertConversationVisible(conversationId, actor)
    return { kind: 'conversation', conversationId, conversation }
  } catch (err) {
    if (!isNotFoundError(err)) throw err
    const { resolvePairTicketIdForConversation } =
      await import('@/lib/server/domains/tickets/pair-thread.service')
    const pairTicketId = await resolvePairTicketIdForConversation(conversationId)
    if (!pairTicketId) throw err
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(pairTicketId, actor)
    return {
      kind: 'conversation',
      conversationId,
      conversation: await loadConversationOr404(conversationId),
      via: 'pair',
    }
  }
}

/**
 * `resolveMessageParent` for a path that names the message, not its parent:
 * a parent the actor cannot see answers as a missing message.
 */
export async function assertMessageParentVisible(
  message: ConversationMessage,
  actor: Actor
): Promise<MessageParent> {
  try {
    return await resolveMessageParent(message, actor)
  } catch (err) {
    if (isNotFoundError(err)) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
    throw err
  }
}
