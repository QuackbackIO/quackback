/**
 * Conversation domain service for the support inbox (channel-agnostic). Postgres is the source of truth; after each write
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
  inArray,
  conversations,
  chatMessages,
  principal,
  user,
  type Conversation,
  type ChatSystemEvent,
} from '@/lib/server/db'
import { isTeamMember } from '@/lib/shared/roles'
import type { ChatAttachment } from '@/lib/server/db'
import type { ConversationId, ChatMessageId, PrincipalId, SegmentId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { isTrustedAttachmentUrl } from '@/lib/server/storage/trusted-url'
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
  type ConversationStatus,
  type ConversationPriority,
  type ConversationEndReason,
  type ConversationDTO,
  type ConversationSide,
} from '@/lib/shared/chat/types'
import {
  applyVisitorReopenStatus,
  applyAgentReopenStatus,
  resolvedAtForStatus,
  shouldRequeueOnAgentOffline,
  unreadWatermarkFromAnchor,
} from './chat.lifecycle'
import {
  publishChatEvent,
  publishAgentChatEvent,
  publishConversationUpdate,
  publishTyping,
} from '@/lib/server/realtime/chat-channels'
import { truncate } from '@/lib/shared/utils/string'
import { notifyVisitorMessage, notifyAgentReply, notifyConversationStarted } from './chat.notify'
import { resolveReplyRecipient } from './chat.recipient'
import { realEmail } from '@/lib/shared/anonymous-email'
import { conversationToDTO, toMessageDTO, authorFromInput, resolveAuthor } from './chat.query'
import {
  emitConversationCreated,
  emitMessageCreated,
  emitMessageNoteCreated,
  emitMessageDeleted,
  emitConversationStatusChanged,
  emitConversationAssigned,
  emitConversationPriorityChanged,
  emitConversationCsatSubmitted,
} from './chat.webhooks'
import { extractMentions } from '@/lib/server/domains/posts/extract-mentions'
import { syncChatMessageMentions } from './sync-chat-mentions'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import type { TiptapContent } from '@/lib/shared/db-types'
import type {
  ChatAuthorInput,
  SendVisitorMessageInput,
  SendVisitorMessageResult,
  SendAgentMessageResult,
} from './chat.types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'chat' })

/** Actor for system-initiated events (auto-routing): no principal, service type. */
function systemActor(): Actor {
  return {
    principalId: null,
    role: null,
    principalType: 'service',
    segmentIds: new Set<SegmentId>(),
  }
}

const PREVIEW_LENGTH = 120
// Matches the 5 MB cap enforced by the upload endpoints.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

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

/** Normalize a captured email; returns undefined when it isn't plausibly one. */
function normalizeEmail(raw: string | undefined): string | undefined {
  const email = raw?.trim().toLowerCase() ?? ''
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined
  return email
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

/**
 * Agent action: record a contact email for a conversation's (typically
 * anonymous) visitor so status updates can reach them — e.g. captured inline
 * when tracking the conversation as a post. Reuses the same reusable
 * `principal.contact_email` slot as pre-chat capture and never overwrites an
 * address already on file. A non-plausible email is a no-op (`captured: false`),
 * so a stray value can't block the caller.
 */
export async function captureVisitorContactEmail(
  conversationId: ConversationId,
  rawEmail: string,
  actor: Actor
): Promise<{ captured: boolean }> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const email = normalizeEmail(rawEmail)
  if (!email) return { captured: false }
  const conversation = await assertConversationViewable(conversationId, actor)
  await db.transaction(async (tx) => {
    // Reusable contact on the visitor principal (survives across conversations).
    await tx
      .update(principal)
      .set({ contactEmail: email })
      .where(and(eq(principal.id, conversation.visitorPrincipalId), isNull(principal.contactEmail)))
    // Mirror onto the conversation so the agent inbox surfaces the address too.
    await tx
      .update(conversations)
      .set({ visitorEmail: email })
      .where(and(eq(conversations.id, conversationId), isNull(conversations.visitorEmail)))
  })
  return { captured: true }
}

/** Visitor send. Starts a conversation when no conversationId is supplied. */
export async function sendVisitorMessage(
  input: SendVisitorMessageInput,
  author: ChatAuthorInput,
  actor: Actor,
  contentJson?: TiptapContent | null
): Promise<SendVisitorMessageResult> {
  const attachments = validateAttachments(input.attachments)
  // Rich-composer doc (inline embeds/images): sanitized on write, like the agent
  // path — but no mention extraction (a visitor carries no team @-mentions).
  const safeContentJson = contentJson ? sanitizeTiptapContent(contentJson) : null
  // A text-less rich message is valid only when it carries an inline image or a
  // shared post; this label also backs the list preview + notification body. A
  // doc with neither (an empty doc) yields '' → treated as no content below.
  const fallbackLabel = richMessageFallbackLabel(safeContentJson)
  // Empty content is valid when there are attachments OR a doc with a real
  // content node (image/embed-only message).
  const content = validateContent(input.content, attachments.length > 0 || !!fallbackLabel)

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
          subject: preview(content || fallbackLabel, attachments),
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
        contentJson: safeContentJson,
        attachments: attachments.length > 0 ? attachments : null,
        metadata: input.metadata ?? null,
      })
      .returning()

    // Capture a pre-chat email once, only when none is recorded yet — a later
    // send can't overwrite an address the visitor already gave.
    const captureEmail =
      !conversation.visitorEmail && input.visitorEmail
        ? normalizeEmail(input.visitorEmail)
        : undefined

    const visitorNextStatus = applyVisitorReopenStatus()
    const [updated] = await tx
      .update(conversations)
      .set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview(content || fallbackLabel, attachments),
        // Visitor is active, so their side is read; a reply surfaces the thread.
        visitorLastReadAt: message.createdAt,
        status: visitorNextStatus,
        // Keep resolvedAt consistent with the new status — a reply that reopens
        // a closed thread must clear the stale resolution timestamp.
        resolvedAt: resolvedAtForStatus(visitorNextStatus, message.createdAt),
        updatedAt: message.createdAt,
        ...(captureEmail ? { visitorEmail: captureEmail } : {}),
      })
      .where(eq(conversations.id, conversation.id))
      .returning()

    // Also stash the captured email at the principal level so it survives across
    // conversations (reusable contact). Don't overwrite an existing address.
    if (captureEmail) {
      await tx
        .update(principal)
        .set({ contactEmail: captureEmail })
        .where(and(eq(principal.id, author.principalId), isNull(principal.contactEmail)))
    }

    return { conversation: updated, message }
  })

  const messageDTO = toMessageDTO(txResult.message, authorFromInput(author))

  // A new conversation appears in the agent inbox; publish the agent-side DTO
  // there (publishConversationUpdate strips agent-only fields for the visitor).
  if (created) {
    const agentDTO = await conversationToDTO(txResult.conversation, 'agent')
    publishConversationUpdate(agentDTO.id, agentDTO)
  }
  publishChatEvent(messageDTO.conversationId, {
    kind: 'message',
    conversationId: messageDTO.conversationId,
    message: messageDTO,
  })

  // A brand-new conversation: try auto-routing it to an active agent. Best-
  // effort (never blocks the send), and runs outside the transaction so a Redis
  // hiccup can't roll back the visitor's message.
  if (created && txResult.conversation.assignedAgentPrincipalId === null) {
    await assignRoutedConversation(txResult.conversation)
  }

  void notifyVisitorMessage({
    conversation: txResult.conversation,
    content: preview(content || fallbackLabel, attachments),
    authorName: author.displayName ?? 'A visitor',
    isFirstMessage: created,
  })

  if (created) {
    void emitConversationCreated(actor, author, txResult.conversation)
  }
  void emitMessageCreated(actor, author, txResult.message, txResult.conversation)

  // Return a VISITOR-side DTO to the caller — never leak the agent-only
  // visitorEmail back to the visitor in the send response.
  const conversationDTO = await conversationToDTO(txResult.conversation, 'visitor')
  return { conversation: conversationDTO, message: messageDTO, created }
}

/**
 * A short preview label for a rich message that has no typed text — an inline
 * image or shared post still needs a non-blank conversation-list snippet +
 * notification body. Returns '' when the doc carries no such node (so a truly
 * empty doc is treated as no content, not a sendable blank message).
 */
function richMessageFallbackLabel(doc: TiptapContent | null | undefined): string {
  for (const node of doc?.content ?? []) {
    if (node.type === 'chatImage') return '📷 Image'
    if (node.type === 'quackbackEmbed') {
      return node.attrs?.kind === 'changelog' ? '🔗 Shared an update' : '🔗 Shared a post'
    }
  }
  return ''
}

export interface StartAgentConversationInput {
  targetPrincipalId: PrincipalId
  content: string
}

/**
 * Agent-initiated conversation with a portal user. The target becomes the
 * conversation's visitor side; the composing agent is auto-assigned and the
 * first message is agent-typed. The first message is ALWAYS emailed (the
 * recipient is by definition not in the thread), so the target must be an
 * identified portal user with a deliverable email — validated before any
 * write. Each compose creates a new conversation (no dedupe against open
 * threads).
 */
export async function startAgentConversation(
  input: StartAgentConversationInput,
  agent: ChatAuthorInput,
  actor: Actor
): Promise<SendVisitorMessageResult> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)

  const content = validateContent(input.content, false)

  const [target] = await db
    .select({
      type: principal.type,
      role: principal.role,
      email: user.email,
      contactEmail: principal.contactEmail,
    })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(eq(principal.id, input.targetPrincipalId))
    .limit(1)

  if (!target) {
    throw new NotFoundError('USER_NOT_FOUND', 'User not found')
  }
  if (isTeamMember(target.role)) {
    throw new ValidationError(
      'CANNOT_MESSAGE_TEAM',
      'Conversations can only be started with portal users, not team members'
    )
  }
  if (target.type !== 'user') {
    throw new ValidationError(
      'NOT_A_PORTAL_USER',
      'Conversations can only be started with identified portal users'
    )
  }
  // realEmail() filters the synthetic anonymous placeholder addresses — they
  // resolve but are not deliverable.
  if (!realEmail(resolveReplyRecipient(target, target.contactEmail, null))) {
    throw new ValidationError(
      'NO_DELIVERABLE_EMAIL',
      'This user has no email address to deliver the message to'
    )
  }

  const txResult = await db.transaction(async (tx) => {
    const [createdConv] = await tx
      .insert(conversations)
      .values({
        visitorPrincipalId: input.targetPrincipalId,
        // The composer owns the thread from the start — it lands in "Mine".
        assignedAgentPrincipalId: agent.principalId,
        status: 'open',
        subject: preview(content, []),
      })
      .returning()

    const [message] = await tx
      .insert(chatMessages)
      .values({
        conversationId: createdConv.id,
        principalId: agent.principalId,
        senderType: 'agent',
        content,
      })
      .returning()

    const [updated] = await tx
      .update(conversations)
      .set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview(content, []),
        // Composing counts as reading on the agent side.
        agentLastReadAt: message.createdAt,
        updatedAt: message.createdAt,
      })
      .where(eq(conversations.id, createdConv.id))
      .returning()

    return { conversation: updated, message }
  })

  const messageDTO = toMessageDTO(txResult.message, await resolveAuthor(agent))
  // Agent-side DTO for the inbox stream; publishConversationUpdate strips
  // agent-only fields from the visitor's copy.
  const agentDTO = await conversationToDTO(txResult.conversation, 'agent')
  publishConversationUpdate(agentDTO.id, agentDTO)
  publishChatEvent(messageDTO.conversationId, {
    kind: 'message',
    conversationId: messageDTO.conversationId,
    message: messageDTO,
  })

  // Always email the first message — fire-and-forget; a delivery failure never
  // rolls back the conversation (it logs inside notifyConversationStarted).
  void notifyConversationStarted({
    conversationId: txResult.conversation.id,
    visitorPrincipalId: txResult.conversation.visitorPrincipalId,
    content: preview(content, []),
    agentName: agent.displayName ?? 'Support',
  })

  void emitConversationCreated(actor, agent, txResult.conversation)
  void emitMessageCreated(actor, agent, txResult.message, txResult.conversation)

  return { conversation: agentDTO, message: messageDTO, created: true }
}

/** Agent reply. Auto-assigns the conversation to the replying agent if unowned. */
export async function sendAgentMessage(
  conversationId: ConversationId,
  rawContent: string,
  agent: ChatAuthorInput,
  actor: Actor,
  rawAttachments?: ChatAttachment[],
  contentJson?: TiptapContent | null
): Promise<SendAgentMessageResult> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)

  const attachments = validateAttachments(rawAttachments)
  // Rich-composer doc (inline embeds/images): sanitized on write like the note
  // path, but no mention extraction — replies carry no team @-mentions.
  const safeContentJson = contentJson ? sanitizeTiptapContent(contentJson) : null
  // A text-less rich message is valid only when it carries an inline image or a
  // shared post; this label also backs the list preview + notification body. A
  // doc with neither (an empty doc) yields '' → treated as no content below.
  const fallbackLabel = richMessageFallbackLabel(safeContentJson)
  // A rich message can be embed/image-only (no text), so empty content is valid
  // when there are attachments OR a doc with a real content node.
  const content = validateContent(rawContent, attachments.length > 0 || !!fallbackLabel)

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
        contentJson: safeContentJson,
        attachments: attachments.length > 0 ? attachments : null,
      })
      .returning()

    const agentNextStatus = applyAgentReopenStatus(existing.status)
    const [updated] = await tx
      .update(conversations)
      .set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview(content || fallbackLabel, attachments),
        // Replying counts as reading; claim the conversation if unassigned.
        agentLastReadAt: message.createdAt,
        assignedAgentPrincipalId: existing.assignedAgentPrincipalId ?? agent.principalId,
        status: agentNextStatus,
        // Keep resolvedAt consistent with the new status (reopening clears it).
        resolvedAt: resolvedAtForStatus(agentNextStatus, message.createdAt),
        updatedAt: message.createdAt,
      })
      .where(eq(conversations.id, conversationId))
      .returning()

    return {
      message,
      conversation: updated,
      previousAgentPrincipalId: existing.assignedAgentPrincipalId,
    }
  })

  const messageDTO = toMessageDTO(txResult.message, await resolveAuthor(agent))
  // Agent-side DTO so the inbox keeps agent-only fields; publishConversationUpdate
  // strips them from the visitor's copy.
  const conversationDTO = await conversationToDTO(txResult.conversation, 'agent')

  publishConversationUpdate(conversationDTO.id, conversationDTO)
  publishChatEvent(messageDTO.conversationId, {
    kind: 'message',
    conversationId: messageDTO.conversationId,
    message: messageDTO,
  })

  void notifyAgentReply({
    conversationId: txResult.conversation.id,
    visitorPrincipalId: txResult.conversation.visitorPrincipalId,
    content: preview(content || fallbackLabel, attachments),
    agentName: agent.displayName ?? 'Support',
    capturedEmail: txResult.conversation.visitorEmail,
  })

  void emitMessageCreated(actor, agent, txResult.message, txResult.conversation)
  if (
    txResult.previousAgentPrincipalId === null &&
    txResult.conversation.assignedAgentPrincipalId !== null
  ) {
    void emitConversationAssigned(actor, txResult.conversation, txResult.previousAgentPrincipalId)
  }

  return { conversation: conversationDTO, message: messageDTO }
}

/**
 * Add an agent-only internal note. Never reaches the visitor: stored with
 * isInternal=true, published only to the agent inbox channel, excluded from
 * visitor read paths + unread counts, and it does not bump the visitor-facing
 * last-message preview. @mentions notify teammates.
 */
export async function addAgentNote(
  conversationId: ConversationId,
  rawContent: string,
  agent: ChatAuthorInput,
  actor: Actor,
  contentJson?: TiptapContent | null,
  attachments?: ChatAttachment[]
): Promise<SendAgentMessageResult> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const content = validateContent(rawContent)
  const noteAttachments =
    attachments && attachments.length > 0 ? attachments.slice(0, MAX_CHAT_ATTACHMENTS) : null

  // Sanitize on write (Layer 1), like every other TipTap-doc path (comments,
  // posts, changelog). Drops disallowed nodes/attrs + caps depth, so a tampered
  // client can't store hostile JSON — and mentions are extracted from the same
  // clean tree below.
  const safeContentJson = contentJson ? sanitizeTiptapContent(contentJson) : null

  await loadConversationOr404(conversationId)
  // Insert + touch in one transaction so a note can't persist without its
  // updatedAt bump.
  const message = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(chatMessages)
      .values({
        conversationId,
        principalId: agent.principalId,
        senderType: 'agent',
        isInternal: true,
        content,
        // Rich doc (mention chips etc.); null for a plain-text note.
        contentJson: safeContentJson,
        // Image/file attachments on the note (agent-only, like the note itself).
        attachments: noteAttachments,
      })
      .returning()
    // Touch updatedAt only — internal notes don't change the visitor-facing
    // last-message preview/time.
    await tx
      .update(conversations)
      .set({ updatedAt: inserted.createdAt })
      .where(eq(conversations.id, conversationId))
    return inserted
  })

  const messageDTO = toMessageDTO(message, await resolveAuthor(agent))

  // Persist @-mentions from the note doc + alert the mentioned teammates BEFORE
  // announcing the note: the inbox event makes every agent's Mentions view
  // refetch, so the rows must already exist or the new mention is missed until
  // the next poll. The doc is the single source of truth for who was mentioned
  // (the picker writes principal ids into mention nodes), validated server-side
  // in the sync. The sync is DB-only + non-throwing, so awaiting it can't fail
  // the note send and adds only a few ms (no email/network like the reply path).
  await syncChatMessageMentions({
    chatMessageId: message.id,
    conversationId,
    mentionedIds: extractMentions(safeContentJson),
    authorPrincipalId: agent.principalId,
    authorName: agent.displayName ?? 'A teammate',
    content,
  })

  // Agent inbox only — the visitor's conversation channel never receives it.
  publishAgentChatEvent({ kind: 'message', conversationId, message: messageDTO })

  // Reload so the published DTO reflects current status/assignment rather
  // than the pre-write snapshot (the admin client replaces its cached
  // conversation with this payload).
  const noteConversation = await loadConversationOr404(conversationId)
  const conversationDTO = await conversationToDTO(noteConversation, 'agent')
  void emitMessageNoteCreated(actor, agent, message, noteConversation)
  return { conversation: conversationDTO, message: messageDTO }
}

/** Agent action: set a conversation's status (open / pending / closed). */
export async function setConversationStatus(
  conversationId: ConversationId,
  status: ConversationStatus,
  actor: Actor
): Promise<Conversation> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const existing = await loadConversationOr404(conversationId)
  const previous = existing.status
  const now = new Date()
  const [updated] = await db
    .update(conversations)
    // Stamp resolvedAt on close, clear it on any reopen.
    .set({ status, resolvedAt: resolvedAtForStatus(status, now), updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .returning()
  // Mark the lifecycle change in the transcript for both sides (author-less).
  if (status !== previous) {
    if (status === 'closed') {
      await emitSystemMessage(conversationId, 'Chat ended', { kind: 'chat_ended' })
    } else if (previous === 'closed') {
      await emitSystemMessage(conversationId, 'Chat reopened', { kind: 'chat_reopened' })
    }
  }
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  if (updated.status !== previous) {
    void emitConversationStatusChanged(actor, updated, previous)
  }
  return updated
}

/** Max length of the optional free-text end-note (mirrors csatComment). */
const MAX_END_NOTE_LENGTH = 2000

/**
 * Agent action: end a conversation with a reason + optional note. Closes the
 * thread (status='closed', stamps resolvedAt) and records WHY, so resolution-
 * rate reporting has a real outcome to count. Mirrors the close path in
 * setConversationStatus — posts the 'Chat ended' system notice (only on a real
 * close, so re-ending an already-closed thread doesn't spam it) and publishes
 * the conversation update so the widget reflects the close over SSE. Returns the
 * updated agent-side DTO so the caller can show the outcome without a refetch.
 */
export async function endConversation(
  conversationId: ConversationId,
  reason: ConversationEndReason,
  note: string | null | undefined,
  actor: Actor
): Promise<ConversationDTO> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const existing = await loadConversationOr404(conversationId)
  const previous = existing.status
  const now = new Date()
  const endNote = note?.trim() ? note.trim().slice(0, MAX_END_NOTE_LENGTH) : null
  const [updated] = await db
    .update(conversations)
    .set({
      status: 'closed',
      resolvedAt: now,
      endReason: reason,
      endNote,
      updatedAt: now,
    })
    .where(eq(conversations.id, conversationId))
    .returning()
  // Mark the close in the transcript for both sides — but only on a real
  // open/pending → closed transition, mirroring setConversationStatus.
  if (previous !== 'closed') {
    await emitSystemMessage(conversationId, 'Chat ended', { kind: 'chat_ended' })
  }
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  if (previous !== 'closed') {
    void emitConversationStatusChanged(actor, updated, previous)
  }
  return dto
}

/**
 * Insert + broadcast an author-less 'system' status event (assignment, chat
 * ended/reopened, …). It carries senderType 'system' with no principal, so it
 * renders as a centered notice on both sides, never counts as unread, and does
 * not bump the conversation's last-message preview. Best-effort: a failure here
 * must not undo the action that already landed.
 */
async function emitSystemMessage(
  conversationId: ConversationId,
  content: string,
  systemEvent?: ChatSystemEvent
): Promise<void> {
  try {
    const [message] = await db
      .insert(chatMessages)
      .values({
        conversationId,
        // Author-less: a system event isn't sent by a person.
        principalId: null,
        senderType: 'system',
        content,
        isInternal: false,
        // The structured event lets clients localize the notice; `content` stays
        // as the stored (English) fallback for legacy rows / unknown kinds.
        metadata: systemEvent ? { systemEvent } : null,
      })
      .returning()
    const messageDTO = toMessageDTO(message, null)
    publishChatEvent(conversationId, { kind: 'message', conversationId, message: messageDTO })
  } catch (err) {
    log.warn({ err }, 'emit system message failed')
  }
}

/** "Conversation assigned to <agent>" status event (best-effort, author-less). */
async function emitAssignmentSystemMessage(
  conversationId: ConversationId,
  agentPrincipalId: PrincipalId
): Promise<void> {
  let name = 'an agent'
  try {
    const [agent] = await db
      .select({ displayName: principal.displayName })
      .from(principal)
      .where(eq(principal.id, agentPrincipalId))
      .limit(1)
    name = agent?.displayName ?? name
  } catch {
    // Fall back to the generic name; the notice still posts.
  }
  await emitSystemMessage(conversationId, `Conversation assigned to ${name}`, {
    kind: 'assigned',
    agentName: name,
  })
}

/**
 * Auto-assign a currently-unassigned conversation to an active agent via the
 * routing strategy, announce it, and broadcast the update. Shared by new-
 * conversation routing and offline re-queue. Returns the assigned agent id, or
 * null when routing declines (disabled / nobody active) or the row was claimed
 * concurrently — the caller then leaves it in the unassigned queue.
 */
async function assignRoutedConversation(conversation: Conversation): Promise<PrincipalId | null> {
  const { routeConversation } = await import('./routing')
  const { assignedPrincipalId } = await routeConversation(conversation)
  if (!assignedPrincipalId) return null
  // Atomic claim — only assign while still unassigned, so concurrent routing
  // (a racing first message, or two agents going offline) can't double-assign.
  const [assigned] = await db
    .update(conversations)
    .set({ assignedAgentPrincipalId: assignedPrincipalId, updatedAt: new Date() })
    .where(
      and(eq(conversations.id, conversation.id), isNull(conversations.assignedAgentPrincipalId))
    )
    .returning()
  if (!assigned) return null
  await emitAssignmentSystemMessage(assigned.id, assignedPrincipalId)
  publishConversationUpdate(assigned.id, await conversationToDTO(assigned, 'agent'))
  void emitConversationAssigned(systemActor(), assigned, null)
  return assignedPrincipalId
}

/** Agent action: (re)assign a conversation, or pass null to unassign. */
export async function assignConversation(
  conversationId: ConversationId,
  agentPrincipalId: PrincipalId | null,
  actor: Actor
): Promise<Conversation> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const existing = await loadConversationOr404(conversationId)
  // Only a team member can be the assignee (any agent, not just the caller).
  if (agentPrincipalId) {
    const [target] = await db
      .select({ role: principal.role })
      .from(principal)
      .where(eq(principal.id, agentPrincipalId))
      .limit(1)
    if (!target || !isTeamMember(target.role)) {
      throw new ValidationError('INVALID_ASSIGNEE', 'Can only assign to a team member')
    }
  }
  const [updated] = await db
    .update(conversations)
    .set({ assignedAgentPrincipalId: agentPrincipalId, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  if (agentPrincipalId) {
    await emitAssignmentSystemMessage(conversationId, agentPrincipalId)
  }
  if (updated.assignedAgentPrincipalId !== existing.assignedAgentPrincipalId) {
    void emitConversationAssigned(actor, updated, existing.assignedAgentPrincipalId)
  }
  return updated
}

/**
 * Free an offline agent's unanswered conversations (see shouldRequeueOnAgentOffline
 * for the rule) and re-route each to another active agent when routing is on;
 * any that can't be routed stay in the unassigned queue. Called when an agent's
 * last live stream closes. Best-effort + system-driven (no actor): a failure
 * must not break stream teardown, and the work is idempotent.
 */
export async function requeueUnansweredOnAgentOffline(
  agentPrincipalId: PrincipalId
): Promise<void> {
  try {
    const assigned = await db
      .select({ id: conversations.id, status: conversations.status })
      .from(conversations)
      .where(eq(conversations.assignedAgentPrincipalId, agentPrincipalId))
    if (assigned.length === 0) return

    // Which of those threads have a real, visitor-facing agent reply (so they
    // stay assigned). Internal notes and soft-deleted messages don't count — a
    // private note or a since-deleted reply must not mask an unanswered chat.
    const answered = await db
      .selectDistinct({ id: chatMessages.conversationId })
      .from(chatMessages)
      .where(
        and(
          inArray(
            chatMessages.conversationId,
            assigned.map((c) => c.id)
          ),
          eq(chatMessages.senderType, 'agent'),
          eq(chatMessages.isInternal, false),
          isNull(chatMessages.deletedAt)
        )
      )
    const answeredIds = new Set(answered.map((r) => r.id))

    const toRequeue = assigned
      .filter((c) => shouldRequeueOnAgentOffline(c.status, answeredIds.has(c.id)))
      .map((c) => c.id)
    if (toRequeue.length === 0) return

    const updated = await db
      .update(conversations)
      .set({ assignedAgentPrincipalId: null, updatedAt: new Date() })
      // Re-check assignee + open status in the WHERE so a concurrent reassign
      // or close between the read and here wins over the re-queue.
      .where(
        and(
          inArray(conversations.id, toRequeue),
          eq(conversations.assignedAgentPrincipalId, agentPrincipalId),
          eq(conversations.status, 'open')
        )
      )
      .returning()

    // Re-route each freed conversation to another active agent (routing fires
    // only when enabled + someone is active); any that can't be routed stay in
    // the unassigned queue, and we just broadcast that state. One at a time (not
    // in parallel) so the load-aware strategy sees each prior assignment and
    // spreads the batch across the online team instead of piling it onto one.
    for (const conversation of updated) {
      // assignRoutedConversation broadcasts the assigned DTO itself on success.
      if (await assignRoutedConversation(conversation)) continue
      // Not re-routed: broadcast the CURRENT row (re-read), so a reassignment
      // that landed during the await isn't clobbered by a stale "unassigned" DTO.
      const [current] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversation.id))
        .limit(1)
      if (current) publishConversationUpdate(current.id, await conversationToDTO(current, 'agent'))
    }
  } catch (err) {
    log.warn({ err }, 'requeue unanswered on agent offline failed')
  }
}

/** Agent action: set a conversation's triage priority. */
export async function setConversationPriority(
  conversationId: ConversationId,
  priority: ConversationPriority,
  actor: Actor
): Promise<Conversation> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const existing = await loadConversationOr404(conversationId)
  const [updated] = await db
    .update(conversations)
    .set({ priority, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  if (updated.priority !== existing.priority) {
    void emitConversationPriorityChanged(actor, updated, existing.priority)
  }
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

  // System events (assignment notices) are status records, not user content —
  // no one deletes them. The guard also narrows senderType to visitor|agent.
  if (message.senderType === 'system') {
    throw new ForbiddenError('FORBIDDEN', 'System messages cannot be deleted')
  }

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

  const deletedEvent = {
    kind: 'message_deleted' as const,
    conversationId: message.conversationId,
    messageId,
  }
  // An internal note never reached the visitor, so its deletion must not either
  // (the message id would otherwise surface on the visitor's channel).
  if (message.isInternal) {
    publishAgentChatEvent(deletedEvent)
  } else {
    publishChatEvent(message.conversationId, deletedEvent)
  }

  // Internal-note deletion stays internal (no public webhook); mirror the
  // publishChatEvent vs publishAgentChatEvent split above.
  if (!message.isInternal) {
    void emitMessageDeleted(actor, message, conversation)
  }
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
  // The widget submits twice (rating first, then an optional comment), and the
  // two POSTs aren't ordered. Only write csatComment when a comment is actually
  // supplied, so a rating-only call can never null a comment that the follow-up
  // already saved (or that arrives in either order).
  const trimmedComment = comment?.trim() ? comment.trim().slice(0, 2000) : undefined
  // A survey is a single satisfaction submission even though it arrives as two
  // calls — fire the public webhook only on the first, so integrations don't
  // double-count or re-trigger automations when the visitor adds a comment.
  const isFirstSubmission = conversation.csatRating == null
  const [updated] = await db
    .update(conversations)
    .set({
      csatRating: rating,
      ...(trimmedComment !== undefined ? { csatComment: trimmedComment } : {}),
      csatSubmittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId))
    .returning()
  // Surface the rating to the agent inbox live (agent-only fields stripped for
  // the visitor). This fires on every call so a follow-up comment still lands.
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  if (isFirstSubmission) void emitConversationCsatSubmitted(actor, updated)
}

/**
 * Which side of a conversation the actor speaks for. Ownership beats role: a
 * team member inside a thread THEY own (their own portal/widget conversation)
 * is the visitor there — deriving from role alone would echo their typing back
 * to them as "agent is typing" and stamp the wrong read watermark.
 */
function conversationSideFor(conversation: Conversation, actor: Actor): ConversationSide {
  return isTeamMember(actor.role) && conversation.visitorPrincipalId !== actor.principalId
    ? 'agent'
    : 'visitor'
}

/** Broadcast an ephemeral typing signal (never persisted). */
export async function signalTyping(conversationId: ConversationId, actor: Actor): Promise<void> {
  // Same access gate as reading the thread — prevents spoofing typing into a
  // conversation the actor can't see.
  const conversation = await assertConversationViewable(conversationId, actor)
  const side = conversationSideFor(conversation, actor)
  // The typist id rides along so the stream layer can drop the typist's own echo.
  publishTyping(conversationId, side, new Date().toISOString(), actor.principalId)
}

/** Mark a conversation read up to now for the actor's side of it. */
export async function markConversationRead(
  conversationId: ConversationId,
  actor: Actor
): Promise<void> {
  const conversation = await assertConversationViewable(conversationId, actor)
  const side = conversationSideFor(conversation, actor)
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

/**
 * Mark a conversation unread for the AGENT side starting at a specific message —
 * the "mark unread from here" action. Moves the agent read-watermark to just
 * before the anchor (backwards-only, see unreadWatermarkFromAnchor) so the
 * anchor and everything after it resurface as unread in the inbox. Agent-gated
 * and published on the inbox channel ONLY: the visitor must never see the
 * agent's watermark move backward (it would wrongly revert a "seen" indicator on
 * the visitor's own messages).
 */
export async function markConversationUnreadFromMessage(
  conversationId: ConversationId,
  messageId: ChatMessageId,
  actor: Actor
): Promise<void> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const conversation = await loadConversationOr404(conversationId)
  // The anchor must belong to this conversation and not be soft-deleted.
  const [message] = await db
    .select({ createdAt: chatMessages.createdAt, deletedAt: chatMessages.deletedAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.conversationId, conversationId)))
    .limit(1)
  if (!message || message.deletedAt) {
    throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  }
  const watermark = unreadWatermarkFromAnchor(conversation.agentLastReadAt, message.createdAt)
  await db
    .update(conversations)
    .set({ agentLastReadAt: watermark })
    .where(eq(conversations.id, conversation.id))
  publishAgentChatEvent({
    kind: 'read',
    conversationId,
    side: 'agent',
    at: (watermark ?? new Date(0)).toISOString(),
  })
}
