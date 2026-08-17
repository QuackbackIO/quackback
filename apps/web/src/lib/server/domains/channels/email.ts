import { resolveConversationFrom } from '@/lib/server/domains/channel-accounts/channel-account.service'
import type { ChannelAdapter } from './types'

/**
 * Email channel: the customer's mailbox is the thread. Agent replies and CSAT
 * requests always send. Lifecycle mail is filled in by the email redesign M3.
 */
export const emailAdapter: ChannelAdapter = {
  id: 'email',

  async resolveDeliveryTarget() {
    return { kind: 'email' }
  },

  async deliverAgentMessage(ctx) {
    const { sendVisitorConversationEmail } =
      await import('@/lib/server/domains/conversation/conversation.notify')
    await sendVisitorConversationEmail({
      conversationId: ctx.conversationId,
      visitorPrincipalId: ctx.visitorPrincipalId,
      recipient: ctx.recipient,
      direction: ctx.direction,
      senderName: ctx.agentName,
      content: ctx.content,
      contentJson: ctx.contentJson,
      ctaUrl: ctx.ctaUrl,
      ctx: { workspaceName: ctx.workspaceName, logoUrl: ctx.logoUrl },
      channel: 'email',
    })
  },

  async deliverLifecycleEvent() {
    // M3: notifyConversationClosed as this adapter's closed / auto_closed mail.
  },

  async deliverCsatRequest(ctx) {
    const from = (await resolveConversationFrom(ctx.conversationId)) ?? undefined
    const { sendCsatRequestEmail } = await import('@quackback/email')
    await sendCsatRequestEmail({
      to: ctx.recipient,
      promptText: ctx.promptText,
      ratingUrls: ctx.ratingUrls,
      workspaceName: ctx.workspaceName,
      logoUrl: ctx.logoUrl ?? undefined,
      from,
    })
  },
}
