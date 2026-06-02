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
  type Conversation,
  type ChatSystemEvent,
} from '@/lib/server/db'
import { isTeamMember } from '@/lib/shared/roles'
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
  type ConversationStatus,
  type ConversationPriority,
} from '@/lib/shared/chat/types'
import {
  applyVisitorReopenStatus,
  applyAgentReopenStatus,
  resolvedAtForStatus,
  shouldRequeueOnAgentOffline,
} from './chat.lifecycle'
import {
  publishChatEvent,
  publishAgentChatEvent,
  publishConversationUpdate,
  publishAgentTyping,
} from '@/lib/server/realtime/chat-channels'
import { truncate } from '@/lib/shared/utils/string'
import { notifyVisitorMessage, notifyAgentReply, notifyNoteMentions } from './chat.notify'
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
  try {
    // Resolve against the app base so relative paths are handled AND dot-segments
    // are canonicalized (`/api/storage/../x` normalizes to `/x` and is rejected).
    const appBase = new URL(config.baseUrl)
    const u = new URL(url, appBase)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (config.s3PublicUrl) {
      const base = new URL(config.s3PublicUrl)
      if (u.hostname === base.hostname && u.pathname.startsWith(base.pathname)) return true
    }
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
        lastMessagePreview: preview(content, attachments),
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
    content: preview(content, attachments),
    authorName: author.displayName ?? 'A visitor',
    isFirstMessage: created,
  })

  // Return a VISITOR-side DTO to the caller — never leak the agent-only
  // visitorEmail back to the visitor in the send response.
  const conversationDTO = await conversationToDTO(txResult.conversation, 'visitor')
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

    const agentNextStatus = applyAgentReopenStatus(existing.status)
    const [updated] = await tx
      .update(conversations)
      .set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview(content, attachments),
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

    return { message, conversation: updated }
  })

  const messageDTO = toMessageDTO(txResult.message, authorFromInput(agent))
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
    content: preview(content, attachments),
    agentName: agent.displayName ?? 'Support',
    capturedEmail: txResult.conversation.visitorEmail,
  })

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
  actor: Actor
): Promise<SendAgentMessageResult> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const content = validateContent(rawContent)

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

  const messageDTO = toMessageDTO(message, authorFromInput(agent))
  // Agent inbox only — the visitor's conversation channel never receives it.
  publishAgentChatEvent({ kind: 'message', conversationId, message: messageDTO })

  void notifyNoteMentions({
    conversationId,
    content,
    authorPrincipalId: agent.principalId,
    authorName: agent.displayName ?? 'A teammate',
  })

  // Reload so the published DTO reflects current status/assignment rather
  // than the pre-write snapshot (the admin client replaces its cached
  // conversation with this payload).
  const conversationDTO = await conversationToDTO(
    await loadConversationOr404(conversationId),
    'agent'
  )
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
  return updated
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
    console.warn('[chat] emitSystemMessage failed:', (err as Error).message)
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
  await loadConversationOr404(conversationId)
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
    console.warn('[chat:routing] requeueUnansweredOnAgentOffline failed:', (err as Error).message)
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
  await loadConversationOr404(conversationId)
  const [updated] = await db
    .update(conversations)
    .set({ priority, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
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
  // the visitor).
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
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
  const at = new Date().toISOString()
  // Agent typing carries the agent id on the inbox channel only (collision
  // detection) — never to the visitor. Visitor typing fans out as before.
  if (side === 'agent' && actor.principalId) {
    publishAgentTyping(conversationId, at, actor.principalId)
  } else {
    publishChatEvent(conversationId, { kind: 'typing', conversationId, side, at })
  }
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
