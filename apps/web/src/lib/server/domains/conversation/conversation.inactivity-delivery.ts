/** Durable transport work for already-committed inactivity actions. */
import { db, eq, conversations, conversationMessages } from '@/lib/server/db'
import type { ConversationMessageId } from '@quackback/ids'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { inactivityPolicy } from '@/lib/shared/conversation-inactivity'
import { getConversationInactivitySettings } from '@/lib/server/domains/settings/settings.conversation-inactivity'
import { logger } from '@/lib/server/logger'
import { conversationToDTO, toMessageDTO } from './conversation.query'
import {
  publishConversationUpdate,
  publishConversationEvent,
} from '@/lib/server/realtime/conversation-channels'
import { notifyAgentReply } from './conversation.notify'
import { persistChannelDelivery } from './conversation.channel-delivery'
import { requireChannelAdapter } from '@/lib/server/domains/channels'

const log = logger.child({ component: 'conversation-inactivity-delivery' })

export async function deliverInactivity(job: ClaimedJob): Promise<void> {
  const messageId = job.payload.messageId as ConversationMessageId
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  if (!message?.conversationId || !message.metadata?.inactivity) return
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId))
    .limit(1)
  if (!conversation) return
  publishConversationEvent(conversation.id, {
    kind: 'message',
    conversationId: conversation.id,
    message: toMessageDTO(message, null),
  })
  publishConversationUpdate(conversation.id, await conversationToDTO(conversation, 'agent'))
  if (
    message.metadata.inactivity.action === 'close' &&
    message.metadata.inactivity.owner.startsWith('assistant')
  ) {
    const { classifyConversationAttributes } =
      await import('@/lib/server/domains/conversation-attributes/ai-classification.service')
    await classifyConversationAttributes(conversation.id, { trigger: 'inactivity' }).catch((err) =>
      log.warn({ err }, 'inactivity attribute classification failed')
    )
  }
  if (!job.payload.mail || message.metadata.channelDelivery?.status === 'sent') return
  const activity = message.metadata.inactivity
  const currentPolicy = inactivityPolicy(
    await getConversationInactivitySettings(),
    activity.owner === 'team' ? 'team' : 'assistant',
    'email'
  )
  if (
    activity.action === 'follow_up' &&
    (currentPolicy.mode !== 'built_in' ||
      !currentPolicy.followUpEnabled ||
      conversation.status !== 'open' ||
      conversation.inactivityAnchorAt?.toISOString() !== activity.anchor ||
      conversation.inactivityOwner !== activity.owner)
  ) {
    await persistChannelDelivery(messageId, {
      status: 'failed',
      channel: 'email',
      error: 'Follow-up cancelled after new activity.',
    })
    return
  }
  try {
    await persistChannelDelivery(messageId, { status: 'pending', channel: 'email' })
    // The same email adapter and threading path used by human replies. A stable
    // message key survives job retries; the transcript was inserted at commit.
    if (activity.action === 'close')
      await requireChannelAdapter('email').deliverLifecycleEvent('auto_closed', {
        conversationId: conversation.id,
        messageId,
        content: message.content,
        strictDelivery: true,
      })
    else
      await notifyAgentReply({
        conversationId: conversation.id,
        visitorPrincipalId: conversation.visitorPrincipalId,
        capturedEmail: conversation.visitorEmail,
        channel: 'email',
        content: message.content,
        agentName: activity.owner === 'team' ? 'Support' : 'Quinn',
        messageId,
        strictDelivery: true,
      })
    await persistChannelDelivery(messageId, { status: 'sent', channel: 'email' })
  } catch (err) {
    await persistChannelDelivery(messageId, {
      status: 'failed',
      channel: 'email',
      error: err instanceof Error ? err.message : 'Email delivery failed',
    })
    log.warn({ err, conversationId: conversation.id, messageId }, 'inactivity delivery failed')
    throw err
  }
}
