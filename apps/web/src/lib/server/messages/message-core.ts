/**
 * Shared core for the polymorphic `conversation_messages` table: the write-side
 * validators and the row -> DTO mapper, used by BOTH the conversation inbox and
 * ticket threads (support platform §4.2). A message is a peer concern of
 * conversations and tickets, owned by neither, so this lives outside both domains
 * (a non-domain module) to keep tickets from depending on the conversation domain.
 */
import type { ConversationMessage, ConversationAttachment } from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import { isTrustedAttachmentUrl } from '@/lib/server/storage/trusted-url'
import { truncate } from '@/lib/shared/utils/string'
import type { TiptapContent } from '@/lib/shared/db-types'
import { tiptapJsonToText, hasTextLeaf } from '@/lib/server/markdown-tiptap'
import type { PrincipalId } from '@quackback/ids'
import {
  MAX_CONVERSATION_MESSAGE_LENGTH,
  MAX_CONVERSATION_ATTACHMENTS,
  type ConversationAuthorDTO,
  type ConversationMessageDTO,
  type MessageSenderType,
} from '@/lib/shared/conversation/types'

export const PREVIEW_LENGTH = 120
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/** Validate + normalize client-supplied attachments (count, trusted url, size). */
export function validateAttachments(
  attachments?: ConversationAttachment[]
): ConversationAttachment[] {
  if (!attachments || attachments.length === 0) return []
  if (attachments.length > MAX_CONVERSATION_ATTACHMENTS) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Too many attachments (max ${MAX_CONVERSATION_ATTACHMENTS})`
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

/**
 * Resolve the plaintext to store for a composer-authored message: the
 * caller's raw content when it carries real text, otherwise a plaintext
 * derived from a text-bearing rich doc — so a client that sends a blank
 * `content` alongside a real `contentJson` (e.g. one that only serializes
 * the doc) still gets a `content` mirror faithful for FTS/transcripts/
 * previews. A doc with no text leaf (image/embed-only) has nothing to
 * derive, so the raw (blank) content passes through unchanged — validateContent,
 * gated by richMessageFallbackLabel, still allows it.
 */
export function resolveMessageContent(
  rawContent: string,
  safeContentJson: TiptapContent | null
): string {
  if (rawContent?.trim() || !safeContentJson || !hasTextLeaf(safeContentJson)) return rawContent
  return tiptapJsonToText(safeContentJson)
}

/** Trim + length-check message text; empty is allowed only with an attachment. */
export function validateContent(raw: string, hasAttachments = false): string {
  const content = raw?.trim() ?? ''
  if (!content && !hasAttachments) {
    throw new ValidationError('VALIDATION_ERROR', 'Message cannot be empty')
  }
  if (content.length > MAX_CONVERSATION_MESSAGE_LENGTH) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Message must be ${MAX_CONVERSATION_MESSAGE_LENGTH.toLocaleString()} characters or less`
    )
  }
  return content
}

/** The list/notification preview line for a message (text, else an attachment). */
export function preview(content: string, attachments: ConversationAttachment[] = []): string {
  if (content) return truncate(content, PREVIEW_LENGTH)
  if (attachments.length > 0) return `📎 ${attachments[0].name || 'Attachment'}`
  return ''
}

/** A display label for a text-less rich message (inline image / shared post).
 *  `chatImage` is the legacy hand-rolled composer's inline node; `resizableImage`
 *  is what the unified RichTextEditor's `onImageUpload` authors instead (support-
 *  grade tickets/conversations, per TICKET-CONTENT-PARITY-SPEC §4) — both count,
 *  so an image-only send from either composer clears validateContent's
 *  empty-content guard the same way.
 *
 *  Recurses the whole tree (an image nested in a blockquote/list still counts)
 *  and requires a surviving `src`: the visitor image-origin sanitize clears an
 *  untrusted image's src to '', and a cleared image renders as nothing — so it
 *  must NOT satisfy the empty-content guard, else a blank bubble would store
 *  while the preview shows "📷 Image". */
export function richMessageFallbackLabel(doc: TiptapContent | null | undefined): string {
  for (const node of doc?.content ?? []) {
    if (node.type === 'chatImage' || node.type === 'image' || node.type === 'resizableImage') {
      if (typeof node.attrs?.src === 'string' && node.attrs.src.length > 0) return '📷 Image'
      continue
    }
    if (node.type === 'quackbackEmbed') {
      return node.attrs?.kind === 'changelog' ? '🔗 Shared an update' : '🔗 Shared a post'
    }
    const nested = richMessageFallbackLabel(node)
    if (nested) return nested
  }
  return ''
}

/** Map a message row + resolved author to its wire DTO (conversation or ticket). */
export function toMessageDTO(
  message: ConversationMessage,
  author: ConversationAuthorDTO | null,
  assistantPrincipalId?: PrincipalId | null
): ConversationMessageDTO {
  return {
    id: message.id,
    conversationId: message.conversationId,
    ticketId: message.ticketId,
    senderType: message.senderType as MessageSenderType,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    author,
    attachments: message.attachments ?? [],
    citations: message.citations ?? [],
    isAssistant: assistantPrincipalId != null && message.principalId === assistantPrincipalId,
    isInternal: message.isInternal,
    contentJson: message.contentJson ?? null,
    viaEmail: message.metadata?.source === 'email',
    systemEvent: message.metadata?.systemEvent ?? null,
  }
}
