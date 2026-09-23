/**
 * What the team keeps after a support message changes. An edit stores the body
 * it replaced; a delete only hides the message, which stays in the agent thread
 * as a placeholder. A moderator redaction is the one way to remove content for
 * good: it wipes the body, attachments, edit history, translations, and the
 * notification previews that quoted it.
 */
import {
  db,
  eq,
  and,
  desc,
  isNull,
  ne,
  or,
  inArray,
  sql,
  conversations,
  conversationMessages,
  conversationMessageEdits,
  conversationMessageTranslations,
  inAppNotifications,
  type ConversationMessage,
  type ConversationMessageMetadata,
} from '@/lib/server/db'
import type { ConversationId, ConversationMessageId, PrincipalId } from '@quackback/ids'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { can } from '@/lib/server/policy/authorize'
import { canViewConversation } from '@/lib/server/policy/conversation'
import type { Actor } from '@/lib/server/policy/types'
import type { TiptapContent } from '@/lib/shared/db-types'
import type {
  AgentConversationMessageDTO,
  ConversationMessageEditDTO,
} from '@/lib/shared/conversation/types'
import {
  publishAgentConversationEvent,
  publishConversationOnlyEvent,
  publishConversationUpdate,
  publishTicketEvent,
} from '@/lib/server/realtime/conversation-channels'
import {
  preview,
  richMessageFallbackLabel,
  toMessageDTO,
  withRemovalNames,
  authorIdsWithRemovers,
} from '@/lib/server/messages/message-core'
import { storedAssetKeyFromSrc } from '@/lib/server/storage/asset-url'
import { logger } from '@/lib/server/logger'
import { truncate } from '@/lib/shared/utils/string'
import { resolveMessageParent } from './message-parent'
import {
  conversationToDTO,
  enrichMessagesForAgent,
  loadAuthors,
  fallbackAuthor,
} from './conversation.query'
import { emitMessageDeleted } from './conversation.webhooks'

const log = logger.child({ component: 'conversation-history' })

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Uploads that belong to one message and so can be deleted with it. */
const MESSAGE_MEDIA_PREFIXES = new Set([
  'chat-images',
  'chat-files',
  'widget-media',
  'portal-media',
])

/** Metadata that routes or dedupes a message and says nothing about its content. */
const REDACTION_KEPT_METADATA = [
  'source',
  'githubCommentId',
  'githubIssueNumber',
  'channelDelivery',
  'inboundDeliveryKey',
  'emailMessageId',
  'inReplyTo',
  'references',
  'crossPostedFromTicketId',
  'repliedAllFromTicketId',
] as const satisfies ReadonlyArray<keyof ConversationMessageMetadata>

/** One message as the agent thread renders it, including who removed it. */
export async function agentMessageDto(
  message: ConversationMessage,
  viewerPrincipalId: PrincipalId
): Promise<AgentConversationMessageDTO> {
  const authors = await loadAuthors(authorIdsWithRemovers([message]))
  const author = message.principalId
    ? (authors.get(message.principalId) ?? fallbackAuthor(message.principalId))
    : null
  const suggestions = new Map()
  if (message.metadata?.postSuggestion) {
    suggestions.set(message.id, message.metadata.postSuggestion)
  }
  const pending = new Map()
  if (message.metadata?.assistantPendingAction) {
    pending.set(message.id, message.metadata.assistantPendingAction)
  }
  const translated = new Map()
  if (message.metadata?.translatedFrom) {
    translated.set(message.id, message.metadata.translatedFrom)
  }
  const [enriched] = await enrichMessagesForAgent(
    [withRemovalNames(toMessageDTO(message, author), message, authors)],
    viewerPrincipalId,
    suggestions,
    pending,
    translated
  )
  return enriched
}

/**
 * Ticket threads listen on the ticket channel, not the inbox's conversation
 * events, so a change shown there needs its own push: to the message's ticket,
 * or to the customer ticket paired with its conversation.
 */
export async function publishTicketThreadUpdate(message: ConversationMessage): Promise<void> {
  let ticketId = message.ticketId
  if (!ticketId && message.conversationId) {
    const { resolvePairTicketIdForConversation } =
      await import('@/lib/server/domains/tickets/pair-thread.service')
    ticketId = await resolvePairTicketIdForConversation(message.conversationId)
  }
  if (!ticketId) return
  const authors = await loadAuthors(authorIdsWithRemovers([message]))
  const author = message.principalId
    ? (authors.get(message.principalId) ?? fallbackAuthor(message.principalId))
    : null
  publishTicketEvent(ticketId, {
    kind: 'ticket_message_updated',
    ticketId,
    message: withRemovalNames(toMessageDTO(message, author), message, authors),
  })
}

/** Keep the body an edit is about to replace. Runs inside the edit's transaction. */
export async function recordMessageEdit(
  tx: Tx,
  message: Pick<ConversationMessage, 'id' | 'content' | 'contentJson'>,
  editorPrincipalId: PrincipalId | null
): Promise<void> {
  await tx.insert(conversationMessageEdits).values({
    messageId: message.id,
    editorPrincipalId,
    previousContent: message.content,
    previousContentJson: message.contentJson ?? null,
  })
}

/** Earlier versions of a message, newest first. Team only. */
export async function listConversationMessageEdits(
  messageId: ConversationMessageId,
  actor: Actor
): Promise<ConversationMessageEditDTO[]> {
  await loadMessageForTeam(messageId, actor)
  const rows = await db
    .select()
    .from(conversationMessageEdits)
    .where(eq(conversationMessageEdits.messageId, messageId))
    // Ids are time-ordered, so they break a same-instant tie deterministically.
    .orderBy(desc(conversationMessageEdits.createdAt), desc(conversationMessageEdits.id))
  const editors = await loadAuthors(rows.map((r) => r.editorPrincipalId))
  return rows.map((r) => ({
    id: r.id,
    content: r.previousContent,
    editedAt: r.createdAt.toISOString(),
    editorName: r.editorPrincipalId
      ? (editors.get(r.editorPrincipalId)?.displayName ?? null)
      : null,
  }))
}

/**
 * Point the conversation's list preview at its newest visible customer-facing
 * message. System lines never write the preview, and a removed message must
 * stop showing there.
 */
export async function refreshConversationPreview(
  exec: Tx | typeof db,
  conversationId: ConversationId
): Promise<void> {
  const [latest] = await exec
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        eq(conversationMessages.isInternal, false),
        ne(conversationMessages.senderType, 'system')
      )
    )
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(1)
  const text = latest
    ? preview(
        latest.content || richMessageFallbackLabel(latest.contentJson ?? null),
        latest.attachments ?? []
      )
    : null
  await exec
    .update(conversations)
    .set({ lastMessagePreview: text })
    .where(eq(conversations.id, conversationId))
}

/**
 * Wipe a message for good. Moderators only. The row stays as a "redacted"
 * placeholder so the thread keeps its shape; everything it said is gone.
 */
export async function redactConversationMessage(
  messageId: ConversationMessageId,
  actor: Actor
): Promise<AgentConversationMessageDTO> {
  const message = await loadMessageForTeam(messageId, actor)
  if (message.senderType === 'system') {
    throw new ForbiddenError('FORBIDDEN', 'System messages cannot be redacted')
  }
  if (!can(actor, PERMISSIONS.CONVERSATION_MANAGE)) {
    throw new ForbiddenError('FORBIDDEN', 'Only moderators can redact messages')
  }
  const viewerId = actor.principalId as PrincipalId
  if (message.redactedAt) return agentMessageDto(message, viewerId)

  const wasVisibleToCustomer = !message.deletedAt && !message.isInternal && !!message.conversationId
  // The GitHub copy goes first, like a delete: if it fails, nothing changes here.
  if (wasVisibleToCustomer && message.metadata?.githubCommentId && message.conversationId) {
    const { deleteGitHubIssueComment } =
      await import('@/lib/server/domains/channels/github-deliver')
    await deleteGitHubIssueComment(message.conversationId, message.metadata.githubCommentId)
  }

  const now = new Date()
  const { redacted, mediaKeys } = await db.transaction(async (tx) => {
    const edits = await tx
      .select({
        previousContent: conversationMessageEdits.previousContent,
        previousContentJson: conversationMessageEdits.previousContentJson,
      })
      .from(conversationMessageEdits)
      .where(eq(conversationMessageEdits.messageId, message.id))
    const keys = messageMediaKeys([message, ...edits.map((e) => e.previousContentJson)])

    const [row] = await tx
      .update(conversationMessages)
      .set({
        content: '',
        contentJson: null,
        attachments: null,
        citations: null,
        metadata: keptMetadata(message.metadata ?? null),
        redactedAt: now,
        redactedByPrincipalId: viewerId,
        deletedAt: message.deletedAt ?? now,
        deletedByPrincipalId: message.deletedByPrincipalId ?? viewerId,
        updatedAt: now,
      })
      .where(eq(conversationMessages.id, message.id))
      .returning()
    await tx
      .delete(conversationMessageEdits)
      .where(eq(conversationMessageEdits.messageId, message.id))
    await tx
      .delete(conversationMessageTranslations)
      .where(eq(conversationMessageTranslations.conversationMessageId, message.id))
    await tx
      .update(inAppNotifications)
      .set({ body: null })
      .where(
        notificationsQuoting(message, [message.content, ...edits.map((e) => e.previousContent)])
      )
    if (message.conversationId && !message.isInternal) {
      await refreshConversationPreview(tx, message.conversationId)
    }
    return { redacted: row, mediaKeys: keys }
  })

  await deleteMedia(mediaKeys)

  const dto = await agentMessageDto(redacted, viewerId)
  await publishRemoval(redacted, dto, actor, wasVisibleToCustomer)
  return dto
}

/**
 * Tell every open view that a message was deleted or redacted: agents get the
 * placeholder, the customer loses the message, and the list re-reads its
 * preview.
 */
export async function publishRemoval(
  message: ConversationMessage,
  dto: AgentConversationMessageDTO,
  actor: Actor,
  wasVisibleToCustomer: boolean
): Promise<void> {
  await publishTicketThreadUpdate(message)
  const conversationId = message.conversationId
  if (!conversationId) return
  publishAgentConversationEvent({ kind: 'message_updated', conversationId, message: dto })
  if (!wasVisibleToCustomer) return
  publishConversationOnlyEvent(conversationId, {
    kind: 'message_deleted',
    conversationId,
    messageId: message.id,
  })
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conversation) return
  publishConversationUpdate(conversation.id, await conversationToDTO(conversation, 'agent'))
  void emitMessageDeleted(actor, message, conversation)
}

/**
 * Notifications whose preview quotes this message. Newer ones carry the message
 * id; older chat notifications only name the conversation, so those match when
 * their preview is exactly what this message, or an earlier version of it,
 * produced.
 */
function notificationsQuoting(message: ConversationMessage, versions: string[]) {
  const byId = sql`${inAppNotifications.metadata} ->> 'conversationMessageId' = ${message.id}`
  const previews = [...new Set(versions.filter(Boolean).map((v) => truncate(v, 140)))]
  if (!message.conversationId || previews.length === 0) return byId
  return or(
    byId,
    and(
      sql`${inAppNotifications.metadata} ->> 'conversationMessageId' IS NULL`,
      sql`${inAppNotifications.metadata} ->> 'conversationId' = ${message.conversationId}`,
      inArray(inAppNotifications.type, ['chat_message', 'chat_mention']),
      inArray(inAppNotifications.body, previews)
    )
  )
}

/** A team member who can see the message's conversation or ticket. */
async function loadMessageForTeam(
  messageId: ConversationMessageId,
  actor: Actor
): Promise<ConversationMessage> {
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  if (!message) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  if (message.conversationId) {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, message.conversationId))
      .limit(1)
    if (
      !conversation ||
      !can(actor, PERMISSIONS.CONVERSATION_VIEW) ||
      !canViewConversation(actor, conversation).allowed
    ) {
      throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
    }
  } else {
    await resolveMessageParent(message, actor)
  }
  return message
}

function keptMetadata(
  metadata: ConversationMessageMetadata | null
): ConversationMessageMetadata | null {
  if (!metadata) return null
  const kept: ConversationMessageMetadata = {}
  for (const key of REDACTION_KEPT_METADATA) {
    if (metadata[key] !== undefined) Object.assign(kept, { [key]: metadata[key] })
  }
  return Object.keys(kept).length > 0 ? kept : null
}

/** Storage keys of uploads a message (and its earlier versions) referenced. */
function messageMediaKeys(
  sources: Array<Pick<ConversationMessage, 'attachments' | 'contentJson'> | TiptapContent | null>
): string[] {
  const srcs: string[] = []
  for (const source of sources) {
    if (!source) continue
    if ('attachments' in source || 'contentJson' in source) {
      const msg = source as Pick<ConversationMessage, 'attachments' | 'contentJson'>
      for (const a of msg.attachments ?? []) srcs.push(a.url)
      collectImageSrcs(msg.contentJson ?? null, srcs)
    } else {
      collectImageSrcs(source as TiptapContent, srcs)
    }
  }
  const keys = srcs
    .map(storedAssetKeyFromSrc)
    .filter((k): k is string => !!k && MESSAGE_MEDIA_PREFIXES.has(k.split('/', 1)[0] ?? ''))
  return [...new Set(keys)]
}

function collectImageSrcs(node: TiptapContent | null, out: string[]): void {
  if (!node || typeof node !== 'object') return
  const src = (node as { attrs?: { src?: unknown } }).attrs?.src
  if (typeof src === 'string') out.push(src)
  for (const child of (node as { content?: TiptapContent[] }).content ?? []) {
    collectImageSrcs(child, out)
  }
}

async function deleteMedia(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const { deleteObject } = await import('@/lib/server/storage/s3')
  await Promise.all(
    keys.map((key) =>
      // The row is already wiped; a stray object is logged for cleanup.
      deleteObject(key).catch((err) =>
        log.warn({ err, key }, 'redacted message media delete failed')
      )
    )
  )
}
