/**
 * The conversation's list preview (`lastMessagePreview`) tracks the newest
 * customer-visible message. Internal notes and system lines never write it,
 * so they are skipped here too (see the system-events "newest message" rule).
 * Shared by the writes that can change which message that is after the fact:
 * an edit and a delete.
 */
import {
  and,
  desc,
  eq,
  isNull,
  ne,
  conversationMessages,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import { preview, richMessageFallbackLabel } from '@/lib/server/messages/message-core'

/** The newest message the customer can see that is not deleted, or undefined. */
export async function newestCustomerVisibleMessage(
  executor: Database | Transaction,
  conversationId: ConversationId
) {
  const [latest] = await executor
    .select({
      id: conversationMessages.id,
      content: conversationMessages.content,
      contentJson: conversationMessages.contentJson,
      attachments: conversationMessages.attachments,
    })
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
  return latest
}

/** The preview line a stored message gives, the same way the send paths write it. */
export function previewOfStoredMessage(message: {
  content: string
  contentJson: Parameters<typeof richMessageFallbackLabel>[0]
  attachments: Parameters<typeof preview>[1] | null
}): string {
  return preview(
    message.content || richMessageFallbackLabel(message.contentJson),
    message.attachments ?? []
  )
}
