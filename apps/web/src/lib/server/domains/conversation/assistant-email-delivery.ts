/**
 * Sending an autonomous Quinn answer out over the email channel
 * (QUINN-PRODUCT P9).
 *
 * The transcript message is already committed when this runs. That split is
 * deliberate and follows the inactivity follow-up exactly: the message and its
 * `pending` delivery record are written in the publication transaction, and
 * the transport is a separate job, so a provider outage delays a delivery
 * rather than losing an answer or holding the publication fence open across a
 * network call.
 *
 * What it adds over the inactivity path is a re-check. Between the commit and
 * the send, a teammate can take the conversation over, the customer can close
 * it, or the workspace can turn the channel off; none of those unsends a
 * message, but all of them mean this workspace should not now email the
 * customer as Quinn. The delivery is recorded as cancelled in that case, which
 * is a state a person can read, rather than being quietly dropped.
 *
 * Threading is the ordinary outbound path's: `notifyAgentReply` mints a
 * Message-ID keyed by this message id (so a retry threads identically) and
 * sets In-Reply-To and References from the conversation's own recorded ids.
 */
import { db, eq, conversations, conversationMessages } from '@/lib/server/db'
import type { ConversationId, ConversationMessageId } from '@quackback/ids'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { notifyAgentReply } from './conversation.notify'
import { persistChannelDelivery } from './conversation.channel-delivery'
import { assistantChannelEligibility } from './assistant-channel-eligibility'

const log = logger.child({ component: 'assistant-email-delivery' })

/** The queue that carries one committed Quinn answer out to a mailbox. */
export const ASSISTANT_EMAIL_DELIVERY_QUEUE = 'assistant-email-delivery'

/** One job per message, so a duplicate enqueue is the same job. */
export function assistantEmailDeliveryDedupeKey(messageId: ConversationMessageId): string {
  return `assistant-email:${messageId}`
}

export async function deliverAssistantEmail(job: ClaimedJob): Promise<void> {
  const messageId = job.payload.messageId as ConversationMessageId | undefined
  if (!messageId) throw new Error('assistant-email-delivery job has no messageId')
  const deliveryLog = log.child({ message_id: messageId, job_id: job.jobId })

  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  if (!message?.conversationId) return
  // Already delivered: a retry after the send committed its own record has
  // nothing left to do and must not send a second copy.
  if (message.metadata?.channelDelivery?.status === 'sent') return

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId as ConversationId))
    .limit(1)
  if (!conversation) return

  // The same rules the intake gate ran, asked again at the moment of sending.
  const verdict = await assistantChannelEligibility(conversation, db)
  if (!verdict.eligible) {
    await persistChannelDelivery(messageId, {
      status: 'failed',
      channel: 'email',
      error: `Not sent: ${verdict.reason.replace(/_/g, ' ')}.`,
    })
    deliveryLog.info(
      { event: 'assistant_email.cancelled', reason: verdict.reason },
      'autonomous email answer was not sent'
    )
    return
  }

  await persistChannelDelivery(messageId, { status: 'pending', channel: 'email' })
  try {
    await notifyAgentReply({
      conversationId: conversation.id,
      visitorPrincipalId: conversation.visitorPrincipalId,
      capturedEmail: conversation.visitorEmail,
      channel: 'email',
      content: message.content,
      agentName: (job.payload.agentName as string | undefined) ?? 'Quinn',
      messageId,
      strictDelivery: true,
    })
  } catch (err) {
    await persistChannelDelivery(messageId, {
      status: 'failed',
      channel: 'email',
      error: err instanceof Error ? err.message : 'The reply could not be sent.',
    })
    deliveryLog.warn({ err, event: 'assistant_email.failed' }, 'autonomous email answer failed')
    // Rethrown so the queue retries: the answer is durable and unsent, which
    // is exactly what a retry is for.
    throw err
  }
  await persistChannelDelivery(messageId, { status: 'sent', channel: 'email' })
  deliveryLog.info({ event: 'assistant_email.sent' }, 'autonomous email answer delivered')
}
