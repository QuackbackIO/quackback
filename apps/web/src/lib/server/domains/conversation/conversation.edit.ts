/**
 * Edit a support message in place. Slack-shaped: only the author can change
 * the body, the row keeps its place in the thread, and `editedAt` is what the
 * "(edited)" mark reads. Customer-visible edits fan out to the visitor; an
 * internal note stays on the inbox channel.
 *
 * An email already delivered is not rewritten. A GitHub issue comment is
 * updated before the row is saved, so a failed remote write leaves the thread
 * unchanged.
 */
import {
  db,
  eq,
  and,
  isNull,
  notInArray,
  conversations,
  conversationMessages,
  conversationMessageMentions,
  type ConversationMessage,
  type ConversationMessageMetadata,
} from '@/lib/server/db'
import type { ConversationMessageId, PrincipalId } from '@quackback/ids'
import { NotFoundError, ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { canEditMessage, canViewConversation } from '@/lib/server/policy/conversation'
import type { Actor } from '@/lib/server/policy/types'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import {
  publishAgentConversationEvent,
  publishConversationOnlyEvent,
  publishConversationUpdate,
} from '@/lib/server/realtime/conversation-channels'
import {
  validateContent,
  richMessageFallbackLabel,
  resolveMessageContent,
  toMessageDTO,
} from '@/lib/server/messages/message-core'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { extractMentions } from '@/lib/server/domains/posts/extract-mentions'
import { assistantPrincipalIdOnce } from '@/lib/server/messages/assistant-principal'
import { resolveMessageParent } from './message-parent'
import { syncConversationMessageMentions } from './sync-conversation-mentions'
import { conversationToDTO, loadAuthors, fallbackAuthor } from './conversation.query'
import {
  agentMessageDto,
  publishTicketThreadUpdate,
  recordMessageEdit,
  refreshConversationPreview,
} from './conversation.history'
import { emitMessageUpdated } from './conversation.webhooks'

function withoutTranslatedFrom(
  metadata: ConversationMessageMetadata | null
): ConversationMessageMetadata | null {
  if (!metadata?.translatedFrom) return metadata
  const next: ConversationMessageMetadata = { ...metadata }
  delete next.translatedFrom
  return Object.keys(next).length > 0 ? next : null
}

function bodyUnchanged(
  message: ConversationMessage,
  content: string,
  contentJson: TiptapContent | null
): boolean {
  if (content !== message.content) return false
  const prev = message.contentJson ?? null
  const next = contentJson
  if (JSON.stringify(prev) === JSON.stringify(next)) return true
  // Opening a plain message in the rich editor and saving it untouched
  // synthesizes a doc. That is not an edit. A doc that adds an image or an
  // embed can keep the same text mirror, and that is an edit.
  return prev == null && richMessageFallbackLabel(next) === ''
}

/** Replace the body of a message the actor authored. */
export async function editConversationMessage(
  messageId: ConversationMessageId,
  rawContent: string,
  contentJson: TiptapContent | null,
  actor: Actor
): Promise<AgentConversationMessageDTO> {
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  if (!message || message.deletedAt) {
    throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  }
  if (message.metadata?.block) {
    throw new ForbiddenError('FORBIDDEN', 'This message cannot be edited')
  }
  const assistantId = await assistantPrincipalIdOnce()
  if (assistantId && message.principalId === assistantId) {
    throw new ForbiddenError('FORBIDDEN', 'Assistant messages cannot be edited')
  }

  const viewerId = actor.principalId
  if (!viewerId) throw new ForbiddenError('FORBIDDEN', 'A session is required to edit a message')

  if (!message.conversationId) {
    if (!message.ticketId) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
    await resolveMessageParent(message, actor)
  } else {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, message.conversationId))
      .limit(1)
    if (!conversation || !canViewConversation(actor, conversation).allowed) {
      throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
    }
  }

  const decision = canEditMessage(actor, {
    senderType: message.senderType,
    authorPrincipalId: message.principalId,
    parent: message.conversationId ? 'conversation' : 'ticket',
    isInternal: message.isInternal,
  })
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)

  return applyEdit(message, rawContent, contentJson, actor, viewerId)
}

async function applyEdit(
  message: ConversationMessage,
  rawContent: string,
  contentJson: TiptapContent | null,
  actor: Actor,
  viewerId: PrincipalId
): Promise<AgentConversationMessageDTO> {
  // An in-flight thread-channel post already captured the original body.
  // Wait until that send settles so the two copies don't diverge.
  if (message.metadata?.channelDelivery?.status === 'pending') {
    throw new ValidationError('VALIDATION_ERROR', 'This message is still sending')
  }

  const safeContentJson = contentJson ? sanitizeTiptapContent(contentJson) : null
  const fallbackLabel = richMessageFallbackLabel(safeContentJson)
  const hasAttachments = (message.attachments?.length ?? 0) > 0
  const content = validateContent(
    resolveMessageContent(rawContent, safeContentJson),
    hasAttachments || !!fallbackLabel
  )

  if (bodyUnchanged(message, content, safeContentJson)) {
    return agentMessageDto(message, viewerId)
  }

  const githubCommentId =
    message.conversationId && !message.isInternal ? message.metadata?.githubCommentId : undefined
  if (githubCommentId && message.conversationId) {
    const { updateGitHubIssueComment } =
      await import('@/lib/server/domains/channels/github-deliver')
    const { contentJsonToMarkdown } = await import('@/lib/server/markdown-tiptap')
    await updateGitHubIssueComment(
      message.conversationId,
      githubCommentId,
      contentJsonToMarkdown(safeContentJson, content)
    )
  }

  const now = new Date()
  const metadata = withoutTranslatedFrom(message.metadata ?? null)
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(conversationMessages)
      .set({
        content,
        contentJson: safeContentJson,
        metadata,
        editedAt: now,
        updatedAt: now,
      })
      .where(and(eq(conversationMessages.id, message.id), isNull(conversationMessages.deletedAt)))
      .returning()
    if (!row) return null
    await recordMessageEdit(tx, message, viewerId)

    if (row.isInternal && row.conversationId) {
      const mentionedIds = extractMentions(safeContentJson)
      await tx
        .delete(conversationMessageMentions)
        .where(
          and(
            eq(conversationMessageMentions.conversationMessageId, row.id),
            mentionedIds.size > 0
              ? notInArray(conversationMessageMentions.principalId, [...mentionedIds])
              : undefined
          )
        )
    }

    if (!row.isInternal && row.conversationId) {
      await refreshConversationPreview(tx, row.conversationId)
    }
    return row
  })
  if (!updated) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')

  if (updated.isInternal && updated.conversationId && updated.principalId) {
    const author = (await loadAuthors([updated.principalId])).get(updated.principalId)
    await syncConversationMessageMentions({
      conversationMessageId: updated.id,
      conversationId: updated.conversationId,
      mentionedIds: extractMentions(safeContentJson),
      authorPrincipalId: updated.principalId,
      authorName: author?.displayName ?? 'A teammate',
      content,
    })
  }

  const dto = await agentMessageDto(updated, viewerId)
  await publishTicketThreadUpdate(updated)

  if (updated.conversationId) {
    publishAgentConversationEvent({
      kind: 'message_updated',
      conversationId: updated.conversationId,
      message: dto,
    })
    if (!updated.isInternal) {
      const author = updated.principalId
        ? ((await loadAuthors([updated.principalId])).get(updated.principalId) ??
          fallbackAuthor(updated.principalId))
        : null
      publishConversationOnlyEvent(updated.conversationId, {
        kind: 'message_edited',
        conversationId: updated.conversationId,
        message: toMessageDTO(updated, author),
      })
      const [current] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, updated.conversationId))
        .limit(1)
      if (current) {
        publishConversationUpdate(current.id, await conversationToDTO(current, 'agent'))
        void emitMessageUpdated(
          actor,
          {
            principalId: viewerId,
            displayName: author?.displayName ?? null,
            avatarUrl: author?.avatarUrl ?? null,
          },
          updated,
          current
        )
      }
    }
  }

  return dto
}
