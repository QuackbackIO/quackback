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
    const { conversationEnvelope, recordSent } =
      await import('@/lib/server/domains/conversation/conversation.email-envelope')
    const envelope = await conversationEnvelope(ctx.conversationId, ctx.workspaceName)

    const { sendCsatRequestEmail } = await import('@quackback/email')
    const result = await sendCsatRequestEmail({
      to: ctx.recipient,
      promptText: ctx.promptText,
      ratingUrls: ctx.ratingUrls,
      workspaceName: ctx.workspaceName,
      logoUrl: ctx.logoUrl ?? undefined,
      conversationSubject: ctx.conversationSubject ?? undefined,
      ...envelope,
      conversationId: ctx.conversationId,
    })
    await recordSent(ctx.conversationId, envelope.messageId, result)
  },
}
