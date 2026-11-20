/**
 * The envelope a workspace email on a conversation goes out in: the thread's
 * From under its sender name (else the workspace's), the conversation's
 * Reply-To, a minted outbound id with the threading headers, and, once sent,
 * that id recorded so a reply to it routes back to the conversation. Shared by
 * the closing notice and the rating request, so one never reads as a
 * different sender from the other.
 */
import type { ConversationId } from '@quackback/ids'
import type { SendingIdentity } from '@quackback/email/sender'
import {
  resolveConversationSender,
  senderFrom,
} from '@/lib/server/domains/channel-accounts/sender-resolver'
import {
  inboundReplyToAddress,
  isEmailInboundConfigured,
  mintOutboundMessageId,
} from './conversation.email-channel'
import { currentMailSlug } from './conversation.mail-slug'
import { recordOutboundEmail, threadIdsForOutbound } from './conversation.email-store'

export interface ConversationEnvelope {
  from: SendingIdentity | undefined
  replyTo: string | undefined
  messageId: string | undefined
  inReplyTo: string | undefined
  references: string[] | undefined
}

/**
 * The envelope for an email on a conversation. Resolving the sender also
 * fixes the thread's sender on its first email (see `resolveConversationSender`).
 */
export async function conversationEnvelope(
  conversationId: ConversationId,
  workspaceName: string
): Promise<ConversationEnvelope> {
  // Only advertise a reply address we can actually receive on.
  const replyTo = isEmailInboundConfigured()
    ? (inboundReplyToAddress(conversationId, currentMailSlug()) ?? undefined)
    : undefined
  const messageId = mintOutboundMessageId(conversationId) ?? undefined
  const [thread, resolved] = await Promise.all([
    messageId ? threadIdsForOutbound(conversationId) : null,
    resolveConversationSender(conversationId),
  ])
  return {
    from: senderFrom(resolved, workspaceName),
    replyTo,
    messageId,
    inReplyTo: thread?.inbound.at(-1) ?? thread?.outbound.at(-1),
    references: thread && thread.merged.length > 0 ? thread.merged : undefined,
  }
}

/**
 * Record the id an email went out under: the provider's when it gave one,
 * else the one minted for it, so a reply to it routes back to the conversation.
 */
export async function recordSent(
  conversationId: ConversationId,
  minted: string | undefined,
  result: { messageId?: string | null } | null | undefined
): Promise<void> {
  const id = result?.messageId === undefined ? minted : (result.messageId ?? undefined)
  if (id) await recordOutboundEmail(id, conversationId)
}
