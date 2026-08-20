import type { ChannelAdapter } from './types'

/**
 * First-party messenger: the widget/portal is the thread. Agent messages are
 * still emailed as offline notifications; lifecycle events stay in-thread.
 */
export const messengerAdapter: ChannelAdapter = {
  id: 'messenger',

  async resolveDeliveryTarget() {
    return { kind: 'realtime' }
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
      channel: 'messenger',
    })
  },

  async deliverLifecycleEvent() {
    // The widget already shows the system message. No mailbox to notify.
  },

  async deliverCsatRequest() {
    // CSAT is the in-widget block. Email rating links are the email adapter.
  },
}
