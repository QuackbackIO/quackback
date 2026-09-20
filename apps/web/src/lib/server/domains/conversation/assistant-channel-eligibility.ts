/** Live channel and trigger-message authority for autonomous email. */
import { and, desc, eq, conversationMessages } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { Conversation } from '@/lib/server/db'
import type { ConversationMessageId } from '@quackback/ids'

export type ChannelIneligibility =
  | 'channel_disabled'
  | 'unverified_sender'
  | 'no_thread'
  | 'no_address'
  | 'not_open'
  | 'taken_over'
  | 'unsupported_source'
export type ChannelEligibility =
  { eligible: true } | { eligible: false; reason: ChannelIneligibility }

/** Null means a run has no trigger. Undefined is intake's latest-message lookup. */
export async function assistantChannelEligibility(
  conversation: Conversation,
  exec: Executor,
  triggerMessageId?: ConversationMessageId | null
): Promise<ChannelEligibility> {
  if (conversation.channel !== 'email') return { eligible: false, reason: 'unsupported_source' }
  const { getAssistantChannels } =
    await import('@/lib/server/domains/settings/settings.assistant-channels')
  if (!(await getAssistantChannels()).email.enabled)
    return { eligible: false, reason: 'channel_disabled' }
  if (!conversation.visitorEmail) return { eligible: false, reason: 'no_address' }
  if (conversation.status !== 'open' || conversation.endReason === 'spam')
    return { eligible: false, reason: 'not_open' }
  if (conversation.assignedAgentPrincipalId) return { eligible: false, reason: 'taken_over' }
  if (triggerMessageId === null) return { eligible: false, reason: 'unverified_sender' }
  const [trigger] = await exec
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversation.id),
        eq(conversationMessages.senderType, 'visitor'),
        triggerMessageId ? eq(conversationMessages.id, triggerMessageId) : undefined
      )
    )
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(1)
  if (!trigger) return { eligible: false, reason: 'no_thread' }
  if (trigger.metadata?.emailSenderAuth !== 'pass')
    return { eligible: false, reason: 'unverified_sender' }
  const threadId = trigger.metadata.emailMessageId
  if (!threadId || threadId.startsWith('qb-transport:'))
    return { eligible: false, reason: 'no_thread' }
  return { eligible: true }
}
