/**
 * Shared core for the polymorphic `conversation_messages` table: the write-side
 * validators and the row -> DTO mapper, used by BOTH the conversation inbox and
 * ticket threads (support platform §4.2). A message is a peer concern of
 * conversations and tickets, owned by neither, so this lives outside both domains
 * (a non-domain module) to keep tickets from depending on the conversation domain.
 */
import type { ConversationMessage, ConversationAttachment } from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import { resignStoredAssetUrl, getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { toUserContentUrl } from '@/lib/server/storage/asset-url'
import type { FileFamily } from '@/lib/shared/files/file-types'
import { truncate } from '@/lib/shared/utils/string'
import type { TiptapContent } from '@/lib/shared/db-types'
import { contentJsonForClient } from '@/lib/server/content/storage-read-urls'
import { tiptapJsonToText, hasTextLeaf } from '@/lib/server/markdown-tiptap'
import type { PrincipalId } from '@quackback/ids'
import {
  MAX_CONVERSATION_MESSAGE_LENGTH,
  type ConversationAttachment as ClientAttachment,
  type ConversationAuthorDTO,
  type ConversationMessageDTO,
  type MessageSenderType,
} from '@/lib/shared/conversation/types'
import { liftInlineImagesToAttachments } from '@/lib/shared/conversation/lift-inline-images'

export const PREVIEW_LENGTH = 120

function clientFileUrl(key: string | undefined): string | null {
  const url = getPublicUrlOrNull(key)
  return url ? toUserContentUrl(url) : null
}
/**
 * The client form of a stored attachment. The URL gets a current read
 * capability (the stored one may have been minted under an older secret), and
 * the preview's storage keys become URLs the browser can load. All three load
 * from the user-content origin when one is configured.
 */
export function attachmentForClient(a: ConversationAttachment): ClientAttachment {
  const { preview, family, ...base } = a
  const out: ClientAttachment = {
    ...base,
    url: toUserContentUrl(resignStoredAssetUrl(a.url)),
    ...(family ? { family: family as FileFamily } : {}),
  }
  if (!preview) return out
  const { thumbKey, renditionKey, ...rest } = preview
  const thumbUrl = clientFileUrl(thumbKey)
  const renditionUrl = clientFileUrl(renditionKey)
  return {
    ...out,
    preview: {
      ...rest,
      ...(thumbUrl ? { thumbUrl } : {}),
      ...(renditionUrl ? { renditionUrl } : {}),
    },
  }
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
  if (attachments.length > 0) return attachments[0].name || 'Attachment'
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
 *  while the preview shows "Image". */
export function richMessageFallbackLabel(doc: TiptapContent | null | undefined): string {
  for (const node of doc?.content ?? []) {
    if (node.type === 'chatImage' || node.type === 'image' || node.type === 'resizableImage') {
      if (typeof node.attrs?.src === 'string' && node.attrs.src.length > 0) return 'Image'
      continue
    }
    if (node.type === 'quackbackEmbed') {
      return node.attrs?.kind === 'changelog' ? 'Shared an update' : 'Shared a post'
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
  const { contentJson, attachments } = liftInlineImagesToAttachments(
    contentJsonForClient(message.contentJson ?? null),
    (message.attachments ?? []).map(attachmentForClient)
  )
  return {
    id: message.id,
    conversationId: message.conversationId,
    ticketId: message.ticketId,
    senderType: message.senderType as MessageSenderType,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    author,
    attachments,
    citations: message.citations ?? [],
    isAssistant: assistantPrincipalId != null && message.principalId === assistantPrincipalId,
    isInternal: message.isInternal,
    contentJson,
    viaEmail: message.metadata?.source === 'email',
    systemEvent: message.metadata?.systemEvent ?? null,
    block: message.metadata?.block ?? null,
    blockReply: message.metadata?.blockReply ?? null,
    channelDelivery:
      message.metadata?.channelDelivery ??
      (message.senderType === 'agent' && message.metadata?.githubCommentId
        ? {
            status: 'sent' as const,
            channel: 'github' as const,
            at: message.createdAt.toISOString(),
            externalId: message.metadata.githubCommentId,
          }
        : null),
  }
}
