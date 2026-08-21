import type { Channel } from '@/lib/shared/channels'
import type { AgentMessageDeliveryCtx } from './types'

/** Agent-message send shared by every first-party adapter. */
export async function deliverAgentMessageOnChannel(
  channel: Channel,
  ctx: AgentMessageDeliveryCtx
): Promise<void> {
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
    channel,
  })
}
