/**
 * What a comment mirroring a ticket reply on a linked issue says, read at
 * dispatch (see `sync/comments.ts`): one public reply on the ticket's thread,
 * either on the ticket itself or on its linked conversation. Never an
 * internal note, a system line or a removed reply, never another message's
 * files, and never the requester's name.
 */
import { db, eq, conversationMessages } from '@/lib/server/db'
import type { ConversationMessageId, PrincipalId, TicketId } from '@quackback/ids'
import type { TicketReplySource } from '@/lib/server/integrations/types'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { attachmentForClient } from '@/lib/server/messages/message-core'
import { loadAuthors } from '../principals/principal-display'
import { resolvePairConversationId } from './pair-thread.service'

/** The reply as it reads now, or null when it is not a public reply on this ticket's thread. */
export async function buildTicketReplySource(
  ticketId: TicketId,
  messageId: ConversationMessageId
): Promise<(TicketReplySource & { principalId: PrincipalId | null }) | null> {
  const message = await db.query.conversationMessages.findFirst({
    where: eq(conversationMessages.id, messageId),
  })
  if (
    !message ||
    message.deletedAt ||
    message.isInternal ||
    (message.senderType !== 'agent' && message.senderType !== 'visitor')
  )
    return null
  const onThread =
    message.ticketId === ticketId ||
    (!!message.conversationId &&
      message.conversationId === (await resolvePairConversationId(ticketId)))
  if (!onThread) return null
  const authorName =
    message.senderType === 'agent' && message.principalId
      ? ((await loadAuthors([message.principalId])).get(message.principalId)?.displayName ?? null)
      : null
  return {
    messageId: message.id,
    ticketId,
    principalId: message.principalId,
    senderType: message.senderType,
    authorName,
    markdown: contentJsonToMarkdown(message.contentJson, message.content),
    attachments: (message.attachments ?? []).map((stored) => {
      const file = attachmentForClient(stored)
      return { name: file.name, url: file.url, contentType: file.contentType }
    }),
  }
}
