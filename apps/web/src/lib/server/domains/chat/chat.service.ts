/**
 * Live chat domain service. Postgres is the source of truth; after each write
 * commits we publish a real-time event over Redis pub/sub (offline in-app /
 * email notifications are dispatched separately by the events pipeline).
 *
 * Two send paths, deliberately separate so sender side is decided server-side
 * and never trusted from the client:
 *   - sendVisitorMessage: the conversation owner posts (senderType 'visitor').
 *   - sendAgentMessage:    a team member replies (senderType 'agent').
 */
import {
  db,
  eq,
  and,
  isNull,
  conversations,
  chatMessages,
  type Conversation,
} from '@/lib/server/db'
import type { ChatAttachment } from '@/lib/server/db'
import type { ConversationId, ChatMessageId, PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { config } from '@/lib/server/config'
import {
  canSendVisitorMessage,
  canStartConversation,
  canActAsAgent,
  canViewConversation,
  canDeleteMessage,
} from '@/lib/server/policy/chat'
import type { Actor } from '@/lib/server/policy/types'
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_ATTACHMENTS,
  type ChatSenderType,
} from '@/lib/shared/chat/types'
import { publishChatEvent } from '@/lib/server/realtime/chat-channels'
import { truncate } from '@/lib/shared/utils/string'
import { notifyVisitorMessage, notifyAgentReply } from './chat.notify'
import { conversationToDTO, toMessageDTO, authorFromInput } from './chat.query'
import type {
  ChatAuthorInput,
  SendVisitorMessageInput,
  SendVisitorMessageResult,
  SendAgentMessageResult,
} from './chat.types'

const PREVIEW_LENGTH = 120
// Matches the 5 MB cap enforced by the upload endpoints.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/**
 * Only accept attachment URLs that came from our own upload pipeline. Parse the
 * URL and match scheme + host + path STRUCTURALLY — a substring check is
 * bypassable (e.g. `javascript:'/api/storage/'` or `https://evil/api/storage/`)
 * and would become stored XSS when rendered into an href/src.
 */
function isTrustedAttachmentUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  // Relative path served by our own storage proxy route.
  if (url.startsWith('/api/storage/')) return true
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (config.s3PublicUrl) {
      const base = new URL(config.s3PublicUrl)
      if (u.hostname === base.hostname && u.pathname.startsWith(base.pathname)) return true
    }
    const appBase = new URL(config.baseUrl)
    return u.hostname === appBase.hostname && u.pathname.startsWith('/api/storage/')
  } catch {
    return false
  }
}

function validateAttachments(attachments?: ChatAttachment[]): ChatAttachment[] {
  if (!attachments || attachments.length === 0) return []
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Too many attachments (max ${MAX_CHAT_ATTACHMENTS})`
    )
  }
  return attachments.map((a) => {
    if (!isTrustedAttachmentUrl(a?.url)) {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid attachment')
    }
    const size = Number(a.size)
    if (!Number.isFinite(size) || size < 0 || size > MAX_ATTACHMENT_BYTES) {
      throw new ValidationError('VALIDATION_ERROR', 'Attachment too large')
    }
    return {
      url: a.url,
      name: String(a.name ?? '').slice(0, 255),
      contentType: String(a.contentType ?? '').slice(0, 128),
      size,
    }
  })
}

/** Validate text content; allow empty only when attachments are present. */
function validateContent(raw: string, hasAttachments = false): string {
  const content = raw?.trim() ?? ''
  if (!content && !hasAttachments) {
    throw new ValidationError('VALIDATION_ERROR', 'Message cannot be empty')
  }
  if (content.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Message must be ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters or less`
    )
  }
  return content
}

function preview(content: string, attachments: ChatAttachment[] = []): string {
  if (content) return truncate(content, PREVIEW_LENGTH)
  if (attachments.length > 0) return `📎 ${attachments[0].name || 'Attachment'}`
  return ''
}

async function loadConversationOr404(conversationId: ConversationId): Promise<Conversation> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row) {
    throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  }
  return row
}

/**
 * Read chokepoint: resolve a conversation the actor is allowed to see, or throw
 * NotFound (never Forbidden) so a non-owner can't probe conversation ids.
 */
export async function assertConversationViewable(
  conversationId: ConversationId,
  actor: Actor
): Promise<Conversation> {
  const conversation = await loadConversationOr404(conversationId)
  const decision = canViewConversation(actor, conversation)
  if (!decision.allowed) {
    throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  }
  return conversation
}

/** Visitor send. Starts a conversation when no conversationId is supplied. */
export async function sendVisitorMessage(
  input: SendVisitorMessageInput,
  author: ChatAuthorInput,
  actor: Actor
): Promise<SendVisitorMessageResult> {
  const attachments = validateAttachments(input.attachments)
  const content = validateContent(input.content, attachments.length > 0)

  let created = false
  const txResult = await db.transaction(async (tx) => {
    let conversation: Conversation
    if (input.conversationId) {
      const [existing] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1)
      if (!existing) {
        throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
      }
      const decision = canSendVisitorMessage(actor, existing)
      if (!decision.allowed) {
        // Hide existence from non-owners; surface the real reason otherwise.
        if (!canViewConversation(actor, existing).allowed) {
          throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
        }
        throw new ForbiddenError('FORBIDDEN', decision.reason)
      }
      conversation = existing
    } else {
      const start = canStartConversation(actor)
      if (!start.allowed) throw new ForbiddenError('FORBIDDEN', start.reason)
      const [createdConv] = await tx
        .insert(conversations)
        .values({
          visitorPrincipalId: author.principalId,
          status: 'open',
          subject: preview(content, attachments),
        })
        .returning()
      conversation = createdConv
      created = true
    }

    const [message] = await tx
      .insert(chatMessages)
      .values({
        conversationId: conversation.id,
        principalId: author.principalId,
        senderType: 'visitor',
        content,
        attachments: attachments.length > 0 ? attachments : null,
      })
      .returning()

    const [updated] = await tx
      .update(conversations)
      .set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview(content, attachments),
        // Visitor is active, so their side is read; a reply reopens a closed thread.
        visitorLastReadAt: message.createdAt,
        status: conversation.status === 'closed' ? 'open' : conversation.status,
        updatedAt: message.createdAt,
      })
      .where(eq(conversations.id, conversation.id))
      .returning()

    return { conversation: updated, message }
  })

  const messageDTO = toMessageDTO(txResult.message, authorFromInput(author))
  const conversationDTO = await conversationToDTO(txResult.conversation, 'agent')

  if (created) {
    publishChatEvent(conversationDTO.id, { kind: 'conversation', conversation: conversationDTO })
  }
  publishChatEvent(messageDTO.conversationId, {
    kind: 'message',
    conversationId: messageDTO.conversationId,
    message: messageDTO,
  })

  void notifyVisitorMessage({
    conversation: txResult.conversation,
    content: preview(content, attachments),
    authorName: author.displayName ?? 'A visitor',
    isFirstMessage: created,
  })

  return { conversation: conversationDTO, message: messageDTO, created }
}

/** Agent reply. Auto-assigns the conversation to the replying agent if unowned. */
export async function sendAgentMessage(
  conversationId: ConversationId,
  rawContent: string,
  agent: ChatAuthorInput,
  actor: Actor,
  rawAttachments?: ChatAttachment[]
): Promise<SendAgentMessageResult> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)

  const attachments = validateAttachments(rawAttachments)
  const content = validateContent(rawContent, attachments.length > 0)

  const txResult = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    if (!existing) {
      throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    }

    const [message] = await tx
      .insert(chatMessages)
      .values({
        conversationId,
        principalId: agent.principalId,
        senderType: 'agent',
        content,
        attachments: attachments.length > 0 ? attachments : null,
      })
      .returning()

    const [updated] = await tx
      .update(conversations)
      .set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview(content, attachments),
        // Replying counts as reading; claim the conversation if unassigned.
        agentLastReadAt: message.createdAt,
        assignedAgentPrincipalId: existing.assignedAgentPrincipalId ?? agent.principalId,
        status: existing.status === 'closed' ? 'open' : existing.status,
        updatedAt: message.createdAt,
      })
      .where(eq(conversations.id, conversationId))
      .returning()

    return { message, conversation: updated }
  })

  const messageDTO = toMessageDTO(txResult.message, authorFromInput(agent))
  const conversationDTO = await conversationToDTO(txResult.conversation, 'visitor')

  publishChatEvent(conversationDTO.id, { kind: 'conversation', conversation: conversationDTO })
  publishChatEvent(messageDTO.conversationId, {
    kind: 'message',
    conversationId: messageDTO.conversationId,
    message: messageDTO,
  })

  void notifyAgentReply({
    visitorPrincipalId: txResult.conversation.visitorPrincipalId,
    content: preview(content, attachments),
    agentName: agent.displayName ?? 'Support',
  })

  return { conversation: conversationDTO, message: messageDTO }
}

/** Agent action: set a conversation's status (open / snoozed / closed). */
export async function setConversationStatus(
  conversationId: ConversationId,
  status: 'open' | 'snoozed' | 'closed',
  actor: Actor
): Promise<Conversation> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  await loadConversationOr404(conversationId)
  const [updated] = await db
    .update(conversations)
    .set({ status, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  const dto = await conversationToDTO(updated, 'agent')
  publishChatEvent(conversationId, { kind: 'conversation', conversation: dto })
  return updated
}

/** Agent action: (re)assign a conversation, or pass null to unassign. */
export async function assignConversation(
  conversationId: ConversationId,
  agentPrincipalId: PrincipalId | null,
  actor: Actor
): Promise<Conversation> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  await loadConversationOr404(conversationId)
  const [updated] = await db
    .update(conversations)
    .set({ assignedAgentPrincipalId: agentPrincipalId, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  const dto = await conversationToDTO(updated, 'agent')
  publishChatEvent(conversationId, { kind: 'conversation', conversation: dto })
  return updated
}

/** Soft-delete a message. Team members may delete any message; a visitor may
 * delete only their own. Broadcasts a message_deleted event so open clients
 * drop the bubble. Idempotent. */
export async function deleteChatMessage(messageId: ChatMessageId, actor: Actor): Promise<void> {
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1)
  if (!message) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')

  const conversation = await loadConversationOr404(message.conversationId)

  const decision = canDeleteMessage(
    actor,
    { senderType: message.senderType, authorPrincipalId: message.principalId },
    conversation
  )
  if (!decision.allowed) {
    // Hide existence from anyone who can't even view the conversation.
    if (!canViewConversation(actor, conversation).allowed) {
      throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
    }
    throw new ForbiddenError('FORBIDDEN', decision.reason)
  }

  await db
    .update(chatMessages)
    .set({ deletedAt: new Date(), deletedByPrincipalId: actor.principalId, updatedAt: new Date() })
    .where(and(eq(chatMessages.id, messageId), isNull(chatMessages.deletedAt)))

  publishChatEvent(message.conversationId, {
    kind: 'message_deleted',
    conversationId: message.conversationId,
    messageId,
  })
}

/** Record a visitor CSAT rating (1-5) on their conversation. */
export async function recordCsat(
  conversationId: ConversationId,
  rating: number,
  comment: string | undefined,
  actor: Actor
): Promise<void> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ValidationError('VALIDATION_ERROR', 'Rating must be between 1 and 5')
  }
  const conversation = await assertConversationViewable(conversationId, actor)
  // Only the visitor who owns the conversation can rate it.
  if (actor.principalId !== conversation.visitorPrincipalId) {
    throw new ForbiddenError('FORBIDDEN', 'Only the visitor can rate this conversation')
  }
  const [updated] = await db
    .update(conversations)
    .set({
      csatRating: rating,
      csatComment: comment?.trim() ? comment.trim().slice(0, 2000) : null,
      csatSubmittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId))
    .returning()
  // Surface the rating to the agent inbox live.
  const dto = await conversationToDTO(updated, 'agent')
  publishChatEvent(conversationId, { kind: 'conversation', conversation: dto })
}

/** Broadcast an ephemeral typing signal (never persisted). */
export async function signalTyping(
  conversationId: ConversationId,
  side: ChatSenderType,
  actor: Actor
): Promise<void> {
  // Same access gate as reading the thread — prevents spoofing typing into a
  // conversation the actor can't see.
  await assertConversationViewable(conversationId, actor)
  publishChatEvent(conversationId, {
    kind: 'typing',
    conversationId,
    side,
    at: new Date().toISOString(),
  })
}

/** Mark a conversation read up to now for one side. */
export async function markConversationRead(
  conversationId: ConversationId,
  side: ChatSenderType,
  actor: Actor
): Promise<void> {
  const conversation = await assertConversationViewable(conversationId, actor)
  const now = new Date()
  await db
    .update(conversations)
    .set(side === 'agent' ? { agentLastReadAt: now } : { visitorLastReadAt: now })
    .where(eq(conversations.id, conversation.id))
  publishChatEvent(conversationId, {
    kind: 'read',
    conversationId,
    side,
    at: now.toISOString(),
  })
}
