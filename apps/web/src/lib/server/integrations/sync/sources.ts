import { db, eq, conversations, conversationMessages, principal, user } from '@/lib/server/db'
import { realEmail } from '@/lib/shared/anonymous-email'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type {
  ConversationCreatedEvent,
  MessageCreatedEvent,
  EventData,
} from '@/lib/server/events/types'

/** Read canonical messages and identity at dispatch; stale snapshots are not delivery authority. */
export async function refreshConversationSyncEvent(
  event: ConversationCreatedEvent | MessageCreatedEvent
): Promise<boolean> {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, event.data.conversation.id as never),
  })
  if (!conversation) return false
  const reference = {
    id: conversation.id,
    status: conversation.status,
    channel: conversation.channel,
    priority: conversation.priority,
    assignedTeamId: conversation.assignedTeamId,
  }
  if (event.type === 'conversation.created') {
    event.data = {
      conversation: {
        ...reference,
        subject: conversation.subject,
        visitorPrincipalId: conversation.visitorPrincipalId,
        visitorEmail: realEmail(conversation.visitorEmail),
        assignedAgentPrincipalId: conversation.assignedAgentPrincipalId,
        createdAt: conversation.createdAt.toISOString(),
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        resolvedAt: conversation.resolvedAt?.toISOString() ?? null,
      },
    }
  } else {
    const message = await db.query.conversationMessages.findFirst({
      where: eq(conversationMessages.id, event.data.message.id as never),
    })
    if (
      !message ||
      message.conversationId !== conversation.id ||
      message.deletedAt ||
      message.isInternal ||
      !['visitor', 'agent'].includes(message.senderType)
    )
      return false
    const author = message.principalId
      ? await db.query.principal.findFirst({ where: eq(principal.id, message.principalId) })
      : null
    const person = author?.userId
      ? await db.query.user.findFirst({ where: eq(user.id, author.userId) })
      : null
    event.data = {
      conversation: reference,
      isFirstMessage: event.data.isFirstMessage,
      message: {
        id: message.id,
        conversationId: conversation.id,
        senderType: message.senderType as 'visitor' | 'agent',
        authorPrincipalId: message.principalId,
        authorName: author?.displayName ?? null,
        authorEmail: realEmail(person?.email),
        content: contentJsonToMarkdown(message.contentJson, message.content),
        createdAt: message.createdAt.toISOString(),
      },
    }
  }
  return true
}

/** Identity in old event snapshots may have been edited or erased meanwhile. */
export async function refreshSyncActor(event: EventData): Promise<void> {
  const actor = event.actor
  if (actor.type === 'service') {
    event.actor = { type: 'service', service: actor.service, principalId: actor.principalId }
    return
  }
  const author = actor.principalId
    ? await db.query.principal.findFirst({ where: eq(principal.id, actor.principalId as never) })
    : null
  const userId = author?.userId ?? actor.userId
  const person = userId
    ? await db.query.user.findFirst({ where: eq(user.id, userId as never) })
    : null
  event.actor = {
    type: 'user',
    ...(author ? { principalId: author.id } : {}),
    ...(person
      ? {
          userId: person.id,
          displayName: author?.displayName ?? person.name,
          ...(realEmail(person.email) ? { email: realEmail(person.email)! } : {}),
        }
      : {}),
  }
}
