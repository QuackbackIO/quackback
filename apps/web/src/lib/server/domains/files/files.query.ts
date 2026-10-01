/**
 * Reads for the inbox's Files sidebar section: every attachment across a
 * conversation or ticket's whole thread, newest first. Agent-only (the
 * conversation/ticket viewability gate lives in the calling server function),
 * so internal notes' attachments are always included — there is no visitor
 * surface for this read.
 */
import { and, db, conversationMessages, desc, eq, isNull } from '@/lib/server/db'
import { attachmentForClient } from '@/lib/server/messages/message-core'
import { loadAuthors, fallbackAuthor } from '@/lib/server/domains/principals/principal-display'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'
import type { ConversationId, ConversationMessageId, TicketId } from '@quackback/ids'

/** Cap on how many attachments the sidebar reads — plenty for any real
 *  conversation, and a hard ceiling against a pathological thread. */
const CONVERSATION_FILES_LIMIT = 200

export interface ConversationFileEntry {
  attachment: ConversationAttachment
  messageId: ConversationMessageId
  senderName: string | null
  sentAt: string
}

/** One of a conversation or a ticket — exactly one parent, as the row itself enforces. */
export type ConversationFilesTarget = { conversationId: ConversationId } | { ticketId: TicketId }

export async function listConversationFiles(
  target: ConversationFilesTarget
): Promise<ConversationFileEntry[]> {
  const parentCondition =
    'conversationId' in target
      ? eq(conversationMessages.conversationId, target.conversationId)
      : eq(conversationMessages.ticketId, target.ticketId)

  const rows = await db
    .select()
    .from(conversationMessages)
    .where(and(parentCondition, isNull(conversationMessages.deletedAt)))
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))

  const authors = await loadAuthors(
    rows.map((m) => m.principalId),
    { preferAccountName: true }
  )

  const entries: ConversationFileEntry[] = []
  for (const m of rows) {
    if (!m.attachments || m.attachments.length === 0) continue
    const author = m.principalId
      ? (authors.get(m.principalId) ?? fallbackAuthor(m.principalId))
      : null
    for (const raw of m.attachments) {
      entries.push({
        attachment: attachmentForClient(raw),
        messageId: m.id,
        senderName: author?.displayName ?? null,
        sentAt: m.createdAt.toISOString(),
      })
      if (entries.length >= CONVERSATION_FILES_LIMIT) return entries
    }
  }
  return entries
}
