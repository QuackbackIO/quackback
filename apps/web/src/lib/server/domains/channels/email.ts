import {
  formatNamedSendingAddress,
  resolveConversationSender,
} from '@/lib/server/domains/channel-accounts/sender-resolver'
import { deliverAgentMessageOnChannel } from './deliver-agent-message'
import type { ChannelAdapter } from './types'

/**
 * Email channel: the customer's mailbox is the thread. Agent replies and CSAT
 * requests always send. Lifecycle mail is filled in by the email redesign M3.
 */
export const emailAdapter: ChannelAdapter = {
  id: 'email',

  deliverAgentMessage: (ctx) => deliverAgentMessageOnChannel('email', ctx),

  async deliverLifecycleEvent(kind, ctx) {
    if (kind === 'reopened') return
    const { notifyConversationClosed } =
      await import('@/lib/server/domains/conversation/conversation.notify-closed')
    await notifyConversationClosed({
      conversationId: ctx.conversationId,
      variant: kind,
      closerPrincipalId: ctx.closerPrincipalId,
    })
  },

  // The same envelope as the closing notice (conversation.notify-closed.ts): the
  // thread's From under the workspace name, the conversation's Reply-To, the
  // threading headers, and the outbound id recorded so a reply routes home. A
  // rating request that arrived as a fresh message from another address would
  // read as a different sender and land outside the thread being rated.
  async deliverCsatRequest(ctx) {
    const { inboundReplyToAddress, isEmailInboundConfigured, mintOutboundMessageId } =
      await import('@/lib/server/domains/conversation/conversation.email-channel')
    const { currentMailSlug } =
      await import('@/lib/server/domains/conversation/conversation.mail-slug')
    const { recordOutboundEmail, threadIdsForOutbound } =
      await import('@/lib/server/domains/conversation/conversation.email-store')

    const replyTo = isEmailInboundConfigured()
      ? (inboundReplyToAddress(ctx.conversationId, currentMailSlug()) ?? undefined)
      : undefined
    const messageId = mintOutboundMessageId(ctx.conversationId)
    const thread = messageId ? await threadIdsForOutbound(ctx.conversationId) : null
    const inReplyTo = thread?.inbound.at(-1) ?? thread?.outbound.at(-1)
    const references = thread && thread.merged.length > 0 ? thread.merged : undefined

    const resolved = await resolveConversationSender(ctx.conversationId)
    const from = resolved
      ? formatNamedSendingAddress(resolved.from, resolved.senderName ?? ctx.workspaceName)
      : undefined

    const { sendCsatRequestEmail } = await import('@quackback/email')
    const result = await sendCsatRequestEmail({
      to: ctx.recipient,
      promptText: ctx.promptText,
      ratingUrls: ctx.ratingUrls,
      workspaceName: ctx.workspaceName,
      logoUrl: ctx.logoUrl ?? undefined,
      from,
      conversationSubject: ctx.conversationSubject ?? undefined,
      replyTo,
      messageId: messageId ?? undefined,
      inReplyTo,
      references,
      conversationId: ctx.conversationId,
    })
    const outboundMessageId =
      result?.messageId === undefined ? messageId : (result.messageId ?? undefined)
    if (outboundMessageId) {
      await recordOutboundEmail(outboundMessageId, ctx.conversationId, 'csat')
    }
  },
}
