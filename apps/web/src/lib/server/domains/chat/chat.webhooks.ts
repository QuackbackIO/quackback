/**
 * Chat → webhook event bridge. Maps conversation/message rows to sanitized
 * event payloads and dispatches them on the shared event bus. Fire-and-forget
 * from chat.service after a write commits: a dispatch failure must never break
 * sending a message (matches the chat.notify pattern).
 *
 * Chat authors carry no userId (ChatAuthorInput), so the EventActor is built
 * from actor.principalType rather than reusing buildEventActor (which keys on
 * userId). Synthetic anonymous emails are stripped via realEmail() everywhere
 * an email surfaces.
 */
import type { Conversation, ConversationMessage } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import type { ChatAuthorInput } from './chat.types'
import type {
  EventActor,
  EventConversationData,
  EventConversationRef,
  EventMessageData,
} from '@/lib/server/events/types'
import { realEmail } from '@/lib/shared/anonymous-email'
import {
  dispatchConversationCreated,
  dispatchConversationStatusChanged,
  dispatchConversationAssigned,
  dispatchConversationPriorityChanged,
  dispatchConversationCsatSubmitted,
  dispatchConversationCsatCommentAdded,
  dispatchMessageCreated,
  dispatchMessageNoteCreated,
  dispatchMessageDeleted,
} from '@/lib/server/events/dispatch'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'chat-webhooks' })

function toEventActor(actor: Actor, author?: ChatAuthorInput | null): EventActor {
  const principalId = actor.principalId ?? undefined
  const displayName = author?.displayName ?? undefined
  if (actor.principalType === 'service') {
    return { type: 'service', principalId, displayName }
  }
  return {
    type: 'user',
    principalId,
    email: realEmail(author?.email ?? null) ?? undefined,
    displayName,
  }
}

function conversationData(c: Conversation): EventConversationData {
  return {
    id: c.id,
    status: c.status,
    channel: c.channel,
    priority: c.priority,
    subject: c.subject ?? null,
    visitorPrincipalId: c.visitorPrincipalId,
    visitorEmail: realEmail(c.visitorEmail),
    assignedAgentPrincipalId: c.assignedAgentPrincipalId ?? null,
    createdAt: c.createdAt.toISOString(),
    lastMessageAt: c.lastMessageAt.toISOString(),
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
  }
}

function conversationRef(c: Conversation): EventConversationRef {
  return { id: c.id, status: c.status, channel: c.channel, priority: c.priority }
}

function messageData(m: ConversationMessage, author: ChatAuthorInput): EventMessageData {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderType: m.senderType as 'visitor' | 'agent',
    authorPrincipalId: m.principalId ?? null,
    authorName: author.displayName ?? null,
    authorEmail: realEmail(author.email ?? null),
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }
}

async function safe(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    log.warn({ err, label }, 'webhook failed')
  }
}

export async function emitConversationCreated(
  actor: Actor,
  author: ChatAuthorInput,
  conversation: Conversation
): Promise<void> {
  await safe('conversation.created', () =>
    dispatchConversationCreated(toEventActor(actor, author), conversationData(conversation))
  )
}

export async function emitMessageCreated(
  actor: Actor,
  author: ChatAuthorInput,
  message: ConversationMessage,
  conversation: Conversation
): Promise<void> {
  await safe('message.created', () =>
    dispatchMessageCreated(
      toEventActor(actor, author),
      messageData(message, author),
      conversationRef(conversation)
    )
  )
}

export async function emitMessageNoteCreated(
  actor: Actor,
  author: ChatAuthorInput,
  message: ConversationMessage,
  conversation: Conversation
): Promise<void> {
  await safe('message.note_created', () =>
    dispatchMessageNoteCreated(
      toEventActor(actor, author),
      messageData(message, author),
      conversationRef(conversation)
    )
  )
}

export async function emitMessageDeleted(
  actor: Actor,
  message: ConversationMessage,
  conversation: Conversation
): Promise<void> {
  await safe('message.deleted', () =>
    dispatchMessageDeleted(
      toEventActor(actor),
      { id: message.id, conversationId: message.conversationId },
      conversationRef(conversation)
    )
  )
}

export async function emitConversationStatusChanged(
  actor: Actor,
  conversation: Conversation,
  previousStatus: string
): Promise<void> {
  await safe('conversation.status_changed', () =>
    dispatchConversationStatusChanged(
      toEventActor(actor),
      conversationRef(conversation),
      previousStatus,
      conversation.status
    )
  )
}

export async function emitConversationAssigned(
  actor: Actor,
  conversation: Conversation,
  previousAgentPrincipalId: string | null
): Promise<void> {
  await safe('conversation.assigned', () =>
    dispatchConversationAssigned(
      toEventActor(actor),
      conversationRef(conversation),
      conversation.assignedAgentPrincipalId ?? null,
      previousAgentPrincipalId
    )
  )
}

export async function emitConversationPriorityChanged(
  actor: Actor,
  conversation: Conversation,
  previousPriority: string
): Promise<void> {
  await safe('conversation.priority_changed', () =>
    dispatchConversationPriorityChanged(
      toEventActor(actor),
      conversationRef(conversation),
      previousPriority,
      conversation.priority
    )
  )
}

export async function emitConversationCsatSubmitted(
  actor: Actor,
  conversation: Conversation
): Promise<void> {
  // Only emit for an actually-submitted rating; never fabricate a 0/no-timestamp event.
  if (conversation.csatRating == null || conversation.csatSubmittedAt == null) return
  const { csatRating, csatSubmittedAt } = conversation
  await safe('conversation.csat_submitted', () =>
    dispatchConversationCsatSubmitted(
      toEventActor(actor),
      conversationRef(conversation),
      csatRating,
      conversation.csatComment ?? null,
      csatSubmittedAt.toISOString()
    )
  )
}

export async function emitConversationCsatCommentAdded(
  actor: Actor,
  conversation: Conversation
): Promise<void> {
  // The optional follow-up comment is its own event so csat_submitted can stay
  // a once-per-survey signal. Only emit once the rating + comment are on file.
  if (
    conversation.csatRating == null ||
    conversation.csatSubmittedAt == null ||
    !conversation.csatComment
  ) {
    return
  }
  const { csatRating, csatComment, csatSubmittedAt } = conversation
  await safe('conversation.csat_comment_added', () =>
    dispatchConversationCsatCommentAdded(
      toEventActor(actor),
      conversationRef(conversation),
      csatRating,
      csatComment,
      csatSubmittedAt.toISOString()
    )
  )
}
