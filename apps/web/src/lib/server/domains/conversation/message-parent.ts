/** Public message actions accept conversation and ticket parents. Private
 * Copilot transcripts stay outside this boundary. */
import type { Conversation, ConversationMessage } from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import { NotFoundError, isNotFoundError } from '@/lib/shared/errors'
import type { Actor } from '@/lib/server/policy/types'
import { assertConversationVisible } from './conversation-visibility'

export type MessageParent =
  | { kind: 'ticket'; ticketId: TicketId }
  | { kind: 'conversation'; conversationId: ConversationId; conversation: Conversation }

/**
 * Resolve `message`'s parent and check that the actor can see it: the ticket
 * through `assertTicketVisible`, the conversation through
 * `assertConversationVisible`. A parent the actor cannot see throws NotFound
 * (never Forbidden), so a teammate outside its scope can't tell it exists.
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
  const conversation = await assertConversationVisible(conversationId, actor)
  return { kind: 'conversation', conversationId, conversation }
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
