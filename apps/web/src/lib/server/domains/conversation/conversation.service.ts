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
  isNotNull,
  lte,
  inArray,
  conversations,
  conversationMessages,
  principal,
  user,
  type Conversation,
  type ConversationSystemEvent,
} from '@/lib/server/db'
import { isTeamMember } from '@/lib/shared/roles'
import type { ConversationAttachment, ConversationMessageCitation, Team } from '@/lib/server/db'
import { getTeam } from '@/lib/server/domains/teams'
import { isBlocked } from '@/lib/server/domains/principals/blocking'
import type {
  ConversationId,
  ConversationMessageId,
  PrincipalId,
  SegmentId,
  TeamId,
} from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import {
  canSendVisitorMessage,
  canStartConversation,
  canActAsAgent,
  canViewConversation,
  canDeleteMessage,
} from '@/lib/server/policy/conversation'
import type { Actor } from '@/lib/server/policy/types'
import {
  MAX_CONVERSATION_ATTACHMENTS,
  HANDOFF_REASON_LABELS,
  type ConversationStatus,
  type ConversationPriority,
  type ConversationEndReason,
  type ConversationDTO,
  type ConversationSide,
} from '@/lib/shared/conversation/types'
import {
  applyVisitorReopenStatus,
  applyAgentReopenStatus,
  shouldWakeSnoozedOnTriage,
  resolvedAtForStatus,
  shouldRequeueOnAgentOffline,
  unreadWatermarkFromAnchor,
} from './conversation.lifecycle'
import {
  publishConversationEvent,
  publishAgentConversationEvent,
  publishConversationUpdate,
  publishTyping,
} from '@/lib/server/realtime/conversation-channels'
import {
  validateAttachments,
  validateContent,
  preview,
  richMessageFallbackLabel,
} from '@/lib/server/messages/message-core'
import {
  notifyVisitorMessage,
  notifyAgentReply,
  notifyConversationStarted,
  notifyTeamAssigned,
} from './conversation.notify'
import { resolveReplyRecipient } from './conversation.recipient'
import { realEmail } from '@/lib/shared/anonymous-email'
import {
  conversationToDTO,
  toMessageDTO,
  authorFromInput,
  resolveAuthor,
} from './conversation.query'
import {
  emitConversationCreated,
  emitMessageCreated,
  emitMessageNoteCreated,
  emitMessageDeleted,
  emitConversationStatusChanged,
  emitConversationAssigned,
  emitConversationPriorityChanged,
  emitConversationCsatSubmitted,
  emitConversationCsatCommentAdded,
} from './conversation.webhooks'
import { extractMentions } from '@/lib/server/domains/posts/extract-mentions'
import { syncConversationMessageMentions } from './sync-conversation-mentions'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import type { TiptapContent } from '@/lib/shared/db-types'
import type {
  ConversationAuthorInput,
  SendVisitorMessageInput,
  SendVisitorMessageResult,
  SendAgentMessageResult,
} from './conversation.types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation' })

/** Actor for system-initiated events (auto-routing): no principal, service type. */
function systemActor(): Actor {
  return {
    principalId: null,
    role: null,
    principalType: 'service',
    segmentIds: new Set<SegmentId>(),
  }
}

/** Normalize a captured email; returns undefined when it isn't plausibly one. */
function normalizeEmail(raw: string | undefined): string | undefined {
  const email = raw?.trim().toLowerCase() ?? ''
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined
  return email
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

  // Changelog auto-subscribe touchpoint (Changelog Settings §2): "conversation
  // contact" — the moment a previously-anonymous visitor's email becomes known.
  const { ensureAutoSubscribed } = await import(
    '@/lib/server/domains/changelog/changelog-subscription.service'
  )
  ensureAutoSubscribed(conversation.visitorPrincipalId).catch((err) =>
    log.error({ err }, 'failed to auto-subscribe to changelog on contact capture')
  )

  return { captured: true }
}

/** Visitor send. Starts a conversation when no conversationId is supplied. */
export async function sendVisitorMessage(
  input: SendVisitorMessageInput,
  author: ConversationAuthorInput,
  actor: Actor,
  contentJson?: TiptapContent | null
): Promise<SendVisitorMessageResult> {
  // Defense in depth: every visitor-ingress channel funnels through here, so a
  // blocked visitor is refused at the shared seam even if a future channel
  // forgets its own pre-check. A single indexed PK read on a low-volume path.
  if (await isBlocked(author.principalId)) {
    throw new ForbiddenError('BLOCKED', 'You are not able to send messages here.')
  }
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
  // The conversation's status BEFORE this message, so the assistant trigger can
  // tell a genuinely reopened thread from one a human deliberately closed.
  let priorStatus: ConversationStatus | null = null
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
      priorStatus = existing.status
    } else {
      const start = canStartConversation(actor)
      if (!start.allowed) throw new ForbiddenError('FORBIDDEN', start.reason)
      const [createdConv] = await tx
        .insert(conversations)
        .values({
          visitorPrincipalId: author.principalId,
          channel: 'messenger',
          status: 'open',
          subject: preview(content || fallbackLabel, attachments),
        })
        .returning()
      conversation = createdConv
      created = true
    }

    const [message] = await tx
      .insert(conversationMessages)
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
        // A customer message always wakes a snoozed thread — clear the timer.
        snoozedUntil: null,
        // The customer is now waiting on a reply: start the clock if it isn't
        // already running (the oldest unanswered message wins).
        waitingSince: conversation.waitingSince ?? message.createdAt,
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
  publishConversationEvent(txResult.conversation.id, {
    kind: 'message',
    conversationId: txResult.conversation.id,
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

  // Quinn, out of band: a widget customer message may trigger an assistant turn.
  // Fire-and-forget with full error isolation so it never blocks or fails the
  // customer's send; the deep gate (respond flag, AI configured, silence rule)
  // lives inside the orchestration, which the assistant domain owns.
  if (shouldConsiderAssistant(txResult.conversation, priorStatus)) {
    void import('@/lib/server/domains/assistant/assistant.orchestrator')
      .then((m) => m.runAssistantTurnForConversation(txResult.conversation.id))
      .catch((err) => log.warn({ err }, 'assistant turn failed'))
  }

  // Return a VISITOR-side DTO to the caller — never leak the agent-only
  // visitorEmail back to the visitor in the send response.
  const conversationDTO = await conversationToDTO(txResult.conversation, 'visitor')
  return { conversation: conversationDTO, message: messageDTO, created }
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
  agent: ConversationAuthorInput,
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
        channel: 'messenger',
        // The composer owns the thread from the start — it lands in "Mine".
        assignedAgentPrincipalId: agent.principalId,
        status: 'open',
        subject: preview(content, []),
      })
      .returning()

    const [message] = await tx
      .insert(conversationMessages)
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
  publishConversationEvent(txResult.conversation.id, {
    kind: 'message',
    conversationId: txResult.conversation.id,
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
  agent: ConversationAuthorInput,
  actor: Actor,
  rawAttachments?: ConversationAttachment[],
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
      .insert(conversationMessages)
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
        // A teammate reply answers the customer — the wait clock stops. (A
        // snoozed thread stays snoozed on ANY teammate reply: send-and-stay, per
        // applyAgentReopenStatus.)
        waitingSince: null,
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
  publishConversationEvent(txResult.conversation.id, {
    kind: 'message',
    conversationId: txResult.conversation.id,
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
  agent: ConversationAuthorInput,
  actor: Actor,
  contentJson?: TiptapContent | null,
  attachments?: ConversationAttachment[]
): Promise<SendAgentMessageResult> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const content = validateContent(rawContent)
  const noteAttachments =
    attachments && attachments.length > 0
      ? attachments.slice(0, MAX_CONVERSATION_ATTACHMENTS)
      : null

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
      .insert(conversationMessages)
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
  await syncConversationMessageMentions({
    conversationMessageId: message.id,
    conversationId,
    mentionedIds: extractMentions(safeContentJson),
    authorPrincipalId: agent.principalId,
    authorName: agent.displayName ?? 'A teammate',
    content,
  })

  // Agent inbox only — the visitor's conversation channel never receives it.
  publishAgentConversationEvent({ kind: 'message', conversationId, message: messageDTO })

  // Reload so the published DTO reflects current status/assignment rather
  // than the pre-write snapshot (the admin client replaces its cached
  // conversation with this payload).
  const noteConversation = await loadConversationOr404(conversationId)
  const conversationDTO = await conversationToDTO(noteConversation, 'agent')
  void emitMessageNoteCreated(actor, agent, message, noteConversation)
  return { conversation: conversationDTO, message: messageDTO }
}

/** Agent action: set a conversation's status (open / snoozed / closed). */
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
    // Stamp resolvedAt on close, clear it on any reopen. Setting status through
    // this plain control always clears the snooze timer — a timed snooze goes
    // through snoozeConversation; 'snoozed' here means "until the customer replies".
    .set({
      status,
      snoozedUntil: null,
      resolvedAt: resolvedAtForStatus(status, now),
      updatedAt: now,
    })
    .where(eq(conversations.id, conversationId))
    .returning()
  // Mark the lifecycle change in the transcript for both sides (author-less).
  if (status !== previous) {
    if (status === 'closed') {
      await emitSystemMessage(conversationId, 'Conversation ended', { kind: 'chat_ended' })
    } else if (previous === 'closed') {
      await emitSystemMessage(conversationId, 'Conversation reopened', { kind: 'chat_reopened' })
    }
  }
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  if (updated.status !== previous) {
    void emitConversationStatusChanged(actor, updated, previous)
  }
  return updated
}

/**
 * Agent action: snooze a conversation until `until` (a wake time), or until the
 * customer next replies when `until` is null. Snoozing is a queue discipline —
 * it never notifies the customer and posts no transcript notice; it only defers
 * the thread on the team's side. Publishes the same inbox/realtime update a
 * manual status change does so every agent's list reflects it immediately.
 */
export async function snoozeConversation(
  conversationId: ConversationId,
  until: Date | null,
  actor: Actor
): Promise<Conversation> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const existing = await loadConversationOr404(conversationId)
  const previous = existing.status
  const now = new Date()
  const [updated] = await db
    .update(conversations)
    // Snoozing is never a resolution — clear resolvedAt if it was set (a closed
    // thread snoozed back into the queue).
    .set({ status: 'snoozed', snoozedUntil: until, resolvedAt: null, updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .returning()
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  if (updated.status !== previous) {
    void emitConversationStatusChanged(actor, updated, previous)
  }
  return updated
}

/**
 * Wake every snoozed conversation whose timer has elapsed: reopen it (status
 * 'open', timer cleared), leaving assignment untouched and running no routing.
 * Publishes the same inbox update + status_changed webhook a manual reopen does.
 * Driven by the snooze-sweep queue (system actor); returns the count woken.
 */
export async function sweepDueSnoozedConversations(): Promise<{ woken: number }> {
  const now = new Date()
  const due = await db
    .update(conversations)
    .set({ status: 'open', snoozedUntil: null, updatedAt: now })
    .where(
      and(
        eq(conversations.status, 'snoozed'),
        isNotNull(conversations.snoozedUntil),
        lte(conversations.snoozedUntil, now)
      )
    )
    .returning()
  const actor = systemActor()
  await Promise.all(
    due.map(async (conversation) => {
      const dto = await conversationToDTO(conversation, 'agent')
      publishConversationUpdate(conversation.id, dto)
      void emitConversationStatusChanged(actor, conversation, 'snoozed')
    })
  )
  return { woken: due.length }
}

/** Max length of the optional free-text end-note (mirrors csatComment). */
const MAX_END_NOTE_LENGTH = 2000

/**
 * Agent action: end a conversation with a reason + optional note. Closes the
 * thread (status='closed', stamps resolvedAt) and records WHY, so resolution-
 * rate reporting has a real outcome to count. Mirrors the close path in
 * setConversationStatus — posts the 'Conversation ended' system notice (only on a real
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
    await emitSystemMessage(conversationId, 'Conversation ended', { kind: 'chat_ended' })
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
  systemEvent?: ConversationSystemEvent
): Promise<void> {
  try {
    const [message] = await db
      .insert(conversationMessages)
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
    publishConversationEvent(conversationId, {
      kind: 'message',
      conversationId,
      message: messageDTO,
    })
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

/** "Conversation assigned to the <team> team" status event (author-less). */
async function emitTeamAssignmentSystemMessage(
  conversationId: ConversationId,
  teamName: string
): Promise<void> {
  await emitSystemMessage(conversationId, `Conversation assigned to the ${teamName} team`)
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
  // A non-assignee (re)assigning a snoozed thread wakes it into the open queue.
  const wake = shouldWakeSnoozedOnTriage(
    existing.status,
    actor.principalId,
    existing.assignedAgentPrincipalId
  )
  const [updated] = await db
    .update(conversations)
    .set({
      assignedAgentPrincipalId: agentPrincipalId,
      ...(wake ? { status: 'open' as const, snoozedUntil: null } : {}),
      updatedAt: new Date(),
    })
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
  if (wake) void emitConversationStatusChanged(actor, updated, existing.status)
  return updated
}

/**
 * Agent action: assign a conversation to a team, or pass null to clear the team
 * assignment. Independent of the agent assignee (§4.12): this never touches the
 * agent column except when the team's assignment_method distributes the
 * conversation to a specific online member (round_robin / balanced), which sets
 * that member as the assignee. Triage-wake matches assignConversation: a
 * non-assignee touching a snoozed thread wakes it.
 */
export async function assignTeam(
  conversationId: ConversationId,
  teamId: TeamId | null,
  actor: Actor
): Promise<Conversation> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const existing = await loadConversationOr404(conversationId)

  // Validate the target (throws NotFound if missing/deleted) and pick a member
  // when the team routes automatically.
  let team: Team | null = null
  let distributedAgentId: PrincipalId | null = null
  if (teamId) {
    team = await getTeam(teamId)
    const { distributeToTeamMember } = await import('./routing')
    distributedAgentId = await distributeToTeamMember(team)
  }

  const wake = shouldWakeSnoozedOnTriage(
    existing.status,
    actor.principalId,
    existing.assignedAgentPrincipalId
  )
  const [updated] = await db
    .update(conversations)
    .set({
      assignedTeamId: teamId,
      // Distribution sets an assignee; a null pick leaves the agent untouched
      // (assigning a team never clears the existing agent).
      ...(distributedAgentId ? { assignedAgentPrincipalId: distributedAgentId } : {}),
      ...(wake ? { status: 'open' as const, snoozedUntil: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId))
    .returning()

  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)

  if (team) {
    await emitTeamAssignmentSystemMessage(conversationId, team.name)
  }
  if (distributedAgentId && distributedAgentId !== existing.assignedAgentPrincipalId) {
    await emitAssignmentSystemMessage(conversationId, distributedAgentId)
  }

  // Ping the team's members (in-app bell), excluding the actor.
  if (teamId && teamId !== existing.assignedTeamId) {
    void notifyTeamAssigned({ conversation: updated, teamId, actorPrincipalId: actor.principalId })
  }

  if (
    updated.assignedTeamId !== existing.assignedTeamId ||
    updated.assignedAgentPrincipalId !== existing.assignedAgentPrincipalId
  ) {
    void emitConversationAssigned(actor, updated, existing.assignedAgentPrincipalId)
  }
  if (wake) void emitConversationStatusChanged(actor, updated, existing.status)
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
    // private note or a since-deleted reply must not mask an unanswered conversation.
    const answered = await db
      .selectDistinct({ id: conversationMessages.conversationId })
      .from(conversationMessages)
      .where(
        and(
          inArray(
            conversationMessages.conversationId,
            assigned.map((c) => c.id)
          ),
          eq(conversationMessages.senderType, 'agent'),
          eq(conversationMessages.isInternal, false),
          isNull(conversationMessages.deletedAt)
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
  // A non-assignee triaging a snoozed thread wakes it back into the open queue.
  const wake = shouldWakeSnoozedOnTriage(
    existing.status,
    actor.principalId,
    existing.assignedAgentPrincipalId
  )
  const [updated] = await db
    .update(conversations)
    .set({
      priority,
      ...(wake ? { status: 'open' as const, snoozedUntil: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId))
    .returning()
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  if (updated.priority !== existing.priority) {
    void emitConversationPriorityChanged(actor, updated, existing.priority)
  }
  if (wake) void emitConversationStatusChanged(actor, updated, existing.status)
  return updated
}

/** Soft-delete a message. Team members may delete any message; a visitor may
 * delete only their own. Broadcasts a message_deleted event so open clients
 * drop the bubble. Idempotent. */
export async function deleteConversationMessage(
  messageId: ConversationMessageId,
  actor: Actor
): Promise<void> {
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  if (!message) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  // Exactly one parent, so a null conversation_id means a ticket-thread message;
  // deletion for those arrives with the customer loop, not this conversation path.
  if (!message.conversationId) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  const conversationId = message.conversationId

  const conversation = await loadConversationOr404(conversationId)

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
    .update(conversationMessages)
    .set({ deletedAt: new Date(), deletedByPrincipalId: actor.principalId, updatedAt: new Date() })
    .where(and(eq(conversationMessages.id, messageId), isNull(conversationMessages.deletedAt)))

  const deletedEvent = {
    kind: 'message_deleted' as const,
    conversationId,
    messageId,
  }
  // An internal note never reached the visitor, so its deletion must not either
  // (the message id would otherwise surface on the visitor's channel).
  if (message.isInternal) {
    publishAgentConversationEvent(deletedEvent)
  } else {
    publishConversationEvent(conversationId, deletedEvent)
  }

  // Internal-note deletion stays internal (no public webhook); mirror the
  // publishConversationEvent vs publishAgentConversationEvent split above.
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

  // Lock the row and read its pre-update CSAT state in the same transaction so
  // the once-per-survey decisions are atomic. The widget fires the rating POST
  // without awaiting it, so a racing comment POST must serialize behind this
  // SELECT ... FOR UPDATE instead of both seeing a null rating and each emitting
  // conversation.csat_submitted.
  const { updated, isFirstSubmission, commentJustAdded } = await db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ csatRating: conversations.csatRating, csatComment: conversations.csatComment })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update')
    const [row] = await tx
      .update(conversations)
      .set({
        csatRating: rating,
        ...(trimmedComment !== undefined ? { csatComment: trimmedComment } : {}),
        csatSubmittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId))
      .returning()
    // Each public webhook fires on the single call that completes its meaning:
    // csat_submitted on the first submission (the rating is banked instantly),
    // csat_comment_added when a comment first lands. Deciding from the locked
    // prev state keeps each event to once per survey under concurrent POSTs.
    return {
      updated: row,
      isFirstSubmission: prev?.csatRating == null,
      commentJustAdded: trimmedComment !== undefined && prev?.csatComment == null,
    }
  })

  // Surface the rating to the agent inbox live (agent-only fields stripped for
  // the visitor). This fires on every call so a follow-up comment still lands.
  const dto = await conversationToDTO(updated, 'agent')
  publishConversationUpdate(conversationId, dto)
  // Emit after the transaction commits so a rolled-back write never webhooks.
  if (isFirstSubmission) void emitConversationCsatSubmitted(actor, updated)
  if (commentJustAdded) void emitConversationCsatCommentAdded(actor, updated)

  // Mirror the CSAT rating onto Quinn's involvement when it was the last handler
  // (best-effort — never fails the rating; the assistant domain owns it).
  void import('@/lib/server/domains/assistant/assistant.orchestrator')
    .then((m) => m.attributeCsatIfLastHandler(conversationId, rating))
    .catch((err) => log.warn({ err }, 'attribute csat to assistant involvement failed'))
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
  publishConversationEvent(conversationId, {
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
  messageId: ConversationMessageId,
  actor: Actor
): Promise<void> {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  const conversation = await loadConversationOr404(conversationId)
  // The anchor must belong to this conversation and not be soft-deleted.
  const [message] = await db
    .select({
      createdAt: conversationMessages.createdAt,
      deletedAt: conversationMessages.deletedAt,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, messageId),
        eq(conversationMessages.conversationId, conversationId)
      )
    )
    .limit(1)
  if (!message || message.deletedAt) {
    throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  }
  const watermark = unreadWatermarkFromAnchor(conversation.agentLastReadAt, message.createdAt)
  await db
    .update(conversations)
    .set({ agentLastReadAt: watermark })
    .where(eq(conversations.id, conversation.id))
  publishAgentConversationEvent({
    kind: 'read',
    conversationId,
    side: 'agent',
    at: (watermark ?? new Date(0)).toISOString(),
  })
}

// -------------------------------------------------------------- assistant (Quinn) ---

/** Actor for an assistant-authored write: the system actor, carrying Quinn's principal id. */
function assistantActor(principalId: PrincipalId): Actor {
  return { ...systemActor(), principalId }
}

/**
 * Cheap synchronous gate before spending on an assistant turn: only the widget
 * channel triggers Quinn today (email + other sources join later phases), and a
 * thread a human deliberately closed must not summon Quinn on the reopen.
 */
export function shouldConsiderAssistant(
  conversation: Conversation,
  priorStatus: ConversationStatus | null
): boolean {
  if (conversation.source !== 'widget') return false
  if (priorStatus === 'closed') return false
  return true
}

/**
 * Append a reply authored by the assistant service principal — the message-
 * append primitive for Quinn. Like an agent reply it bumps the last-message
 * preview and reopens a closed thread, but it never claims assignment (Quinn
 * fronts, it does not own) and it never marks the agent side read. `waiting`
 * controls the customer wait clock: an answer stops it; a hand-off restarts it
 * so the team sees a thread waiting on a human. Delivered over the normal
 * realtime publish; the visitor agent-reply NOTIFICATION is suppressed (an
 * assistant reply is instant and in-session, not an offline follow-up), but the
 * message still webhooks as an ordinary conversation message.
 */
export async function appendAssistantReply(
  conversationId: ConversationId,
  content: string,
  author: ConversationAuthorInput,
  opts: { waiting: boolean; citations?: ConversationMessageCitation[] }
): Promise<void> {
  const txResult = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    if (!existing) throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        conversationId,
        principalId: author.principalId,
        senderType: 'agent',
        content,
        citations: opts.citations?.length ? opts.citations : null,
      })
      .returning()
    const nextStatus = applyAgentReopenStatus(existing.status)
    const [updated] = await tx
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
    return { conversation: updated, message }
  })

  const messageDTO = toMessageDTO(txResult.message, authorFromInput(author), author.principalId)
  const conversationDTO = await conversationToDTO(txResult.conversation, 'agent')
  publishConversationUpdate(conversationDTO.id, conversationDTO)
  publishConversationEvent(txResult.conversation.id, {
    kind: 'message',
    conversationId: txResult.conversation.id,
    message: messageDTO,
  })
  void emitMessageCreated(
    assistantActor(author.principalId),
    author,
    txResult.message,
    txResult.conversation
  )
}

/**
 * Post an agent-only internal note (authored by Quinn) recording why it handed
 * off, so the teammate who picks the conversation up has context at a glance.
 * Inbox channel only — it never reaches the visitor, mirroring `addNote`.
 */
export async function appendAssistantHandoffNote(
  conversationId: ConversationId,
  reason: string,
  author: ConversationAuthorInput
): Promise<void> {
  const why = HANDOFF_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')
  const content = `Handed off to the team — ${why}.`
  const [message] = await db
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId: author.principalId,
      senderType: 'agent',
      isInternal: true,
      content,
    })
    .returning()
  const messageDTO = toMessageDTO(message, authorFromInput(author), author.principalId)
  publishAgentConversationEvent({ kind: 'message', conversationId, message: messageDTO })
}

/**
 * Execute a hand-off Quinn decided on: record the structured reason on the
 * conversation for the receiving human, keep it open, and route it to a
 * teammate via the existing auto-assign strategy (Quinn never opens a stream, so
 * it is never a routing candidate). If nobody is routable it stays in the
 * unassigned queue with the wait clock running.
 */
export async function executeAssistantHandoff(
  conversationId: ConversationId,
  reason: string
): Promise<void> {
  const existing = await loadConversationOr404(conversationId)
  const nextAttributes = {
    ...(existing.customAttributes ?? {}),
    assistant_escalation_reason: reason,
  }
  const [updated] = await db
    .update(conversations)
    .set({ customAttributes: nextAttributes, status: 'open', updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  // A visitor-visible transition marker so the customer clearly sees the shift
  // from Quinn to the human team (localized on the client via systemEvent.kind).
  await emitSystemMessage(conversationId, 'Connecting you to the team', {
    kind: 'assistant_handoff',
  })
  const assigned = await assignRoutedConversation(updated)
  // assignRoutedConversation broadcasts the assigned DTO itself on success; when
  // routing declines, still surface the updated attributes/status to the inbox.
  if (!assigned) {
    publishConversationUpdate(updated.id, await conversationToDTO(updated, 'agent'))
  }
}
