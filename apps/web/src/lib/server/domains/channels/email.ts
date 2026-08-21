import { resolveConversationFrom } from '@/lib/server/domains/channel-accounts/channel-account.service'
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
    const { notifyConversationClosed } =
      await import('@/lib/server/domains/conversation/conversation.notify-closed')
    await notifyConversationClosed({
      conversationId: ctx.conversationId,
      variant: kind,
      closerPrincipalId: ctx.closerPrincipalId,
    })
  },

  async deliverCsatRequest(ctx) {
    const { enforceEmailBudget } = await import('@/lib/server/domains/settings/tier-enforce')
    await enforceEmailBudget()
    const from = (await resolveConversationFrom(ctx.conversationId)) ?? undefined
    const { sendCsatRequestEmail } = await import('@quackback/email')
    await sendCsatRequestEmail({
      to: ctx.recipient,
      promptText: ctx.promptText,
      ratingUrls: ctx.ratingUrls,
      workspaceName: ctx.workspaceName,
      logoUrl: ctx.logoUrl ?? undefined,
      from,
      conversationId: ctx.conversationId,
    })
  },
}
