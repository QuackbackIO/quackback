import {
  conversations,
  conversationMessages,
  eq,
  type Transaction,
  type Conversation,
  type ConversationMessage,
  type ConversationMessageMetadata,
} from '@/lib/server/db'
import type { ConversationId, SupportAgentId } from '@quackback/ids'
import type {
  ConversationMessageCitation,
  ConversationMessageDTO,
} from '@/lib/shared/conversation/types'
import type { TiptapContent } from '@/lib/server/db'
import type { ConversationAuthorInput } from './conversation.types'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import { preview, toMessageDTO } from '@/lib/server/messages/message-core'
import { getChannelDescriptor } from '@/lib/shared/channels'
import { applyAgentReopenStatus, resolvedAtForStatus } from './conversation.lifecycle'
import { resolveAuthorAudiences, conversationToDTO } from './conversation.query'
import {
  publishConversationUpdate,
  publishConversationMessage,
} from '@/lib/server/realtime/conversation-channels'
import { emitMessageCreated } from './conversation.webhooks'
import { logger } from '@/lib/server/logger'

export interface AssistantReplyOptions {
  waiting: boolean
  emitCreated?: boolean
  citations?: ConversationMessageCitation[]
  contentJson?: TiptapContent | null
  metadata?: ConversationMessageMetadata | null
  /** Present when publication must be fenced to this answerer. Null means the built-in AI. */
  controllerAgentId?: SupportAgentId | null
}

export interface StoredAssistantReply {
  eventRecorded?: boolean
  conversation: Conversation
  message: ConversationMessage
}

/** The caller's transaction owns both its turn receipt and the customer-visible message. */
export async function persistAssistantReply(
  tx: Transaction,
  conversationId: ConversationId,
  content: string,
  author: ConversationAuthorInput,
  opts: AssistantReplyOptions
): Promise<StoredAssistantReply> {
  const [existing] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .for('update')
  if (!existing) throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  if (
    'controllerAgentId' in opts &&
    (existing.controllerAgentId ?? null) !== opts.controllerAgentId
  ) {
    throw new ConflictError('NOT_CONTROLLER', 'The conversation has another controller')
  }
  const [message] = await tx
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId: author.principalId,
      senderType: 'agent',
      content,
      contentJson: opts.contentJson ?? null,
      citations: opts.citations?.length ? opts.citations : null,
      metadata: opts.metadata ?? null,
    })
    .returning()
  const nextStatus = applyAgentReopenStatus(
    existing.status,
    getChannelDescriptor(existing.channel)?.reopenOnReply ?? 'always'
  )
  const [conversation] = await tx
    .update(conversations)
    .set({
      lastMessageAt: message.createdAt,
      lastMessagePreview: preview(content, []),
      status: nextStatus,
      waitingSince: opts.waiting ? message.createdAt : null,
      resolvedAt: resolvedAtForStatus(nextStatus, message.createdAt),
      updatedAt: message.createdAt,
    })
    .where(eq(conversations.id, conversationId))
    .returning()
  if (opts.emitCreated) {
    const { emitMessageCreatedInTransaction } = await import('./conversation.webhooks')
    await emitMessageCreatedInTransaction(tx, author, message, conversation)
  }
  return { conversation, message, eventRecorded: opts.emitCreated }
}

/** Publish after commit. A transport failure cannot undo the stored answer or reopen its turn. */
export async function publishAssistantReply(
  stored: StoredAssistantReply,
  author: ConversationAuthorInput
): Promise<ConversationMessageDTO> {
  const fallbackAuthor = {
    principalId: author.principalId,
    displayName: author.displayName ?? null,
    avatarUrl: author.avatarUrl ?? null,
  }
  let dto = toMessageDTO(stored.message, fallbackAuthor, author.principalId)
  try {
    const authored = await resolveAuthorAudiences(author)
    dto = toMessageDTO(stored.message, authored.supportAuthor, author.principalId)
    const conversation = await conversationToDTO(stored.conversation, 'agent')
    await publishConversationUpdate(conversation.id, conversation)
    publishConversationMessage(
      conversation.id,
      {
        visitor: toMessageDTO(stored.message, authored.publicAuthor, author.principalId),
        agent: dto,
      },
      { conversationUpdated: true }
    )
    if (!stored.eventRecorded)
      await emitMessageCreated(
        {
          principalId: author.principalId,
          role: 'member',
          principalType: 'service',
          segmentIds: new Set(),
        },
        author,
        stored.message,
        stored.conversation,
        false
      )
  } catch (err) {
    logger.warn(
      { err, conversation_id: stored.conversation.id, message_id: stored.message.id },
      'stored assistant reply could not be broadcast'
    )
  }
  return dto
}
