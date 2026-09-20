/** Durable, at-most-once dispatch of a committed Quinn email answer. */
import {
  db,
  and,
  desc,
  eq,
  sql,
  conversations,
  conversationMessages,
  assistantRuns,
  ticketConversations,
} from '@/lib/server/db'
import type { ConversationMessageId } from '@quackback/ids'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { makeLogger } from '@/lib/server/logger'
import { notifyAgentReply, EmailNotSentError } from './conversation.notify'
import { persistChannelDelivery } from './conversation.channel-delivery'
import { assistantChannelEligibility } from './assistant-channel-eligibility'
import { getLatestInvolvement, recordAssistantAnswer } from '../assistant/assistant.involvement'
import { broadcastInboxMessageUpdated } from './message.actions'

const log = makeLogger('assistant-email-delivery')
const UNCONFIRMED = 'Delivery unconfirmed. Not retried automatically.'
export const ASSISTANT_EMAIL_DELIVERY_QUEUE = 'assistant-email-delivery'
export function assistantEmailDeliveryDedupeKey(messageId: ConversationMessageId): string {
  return `assistant-email:${messageId}`
}

export async function deliverAssistantEmail(job: ClaimedJob): Promise<void> {
  const messageId = job.payload.messageId as ConversationMessageId | undefined
  if (!messageId) throw new Error('assistant-email-delivery job has no messageId')
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
  if (
    !message ||
    !message.conversationId ||
    message.isInternal ||
    message.senderType !== 'agent' ||
    !message.assistantRunId
  )
    return
  if (message.metadata?.channelDelivery?.status === 'sent') return
  if (message.metadata?.assistantEmailDispatch) {
    if (message.metadata.assistantEmailDispatch.jobId === job.jobId) {
      await persistChannelDelivery(messageId, {
        status: 'failed',
        channel: 'email',
        error: UNCONFIRMED,
      })
    }
    return
  }
  const [run] = await db
    .select()
    .from(assistantRuns)
    .where(eq(assistantRuns.id, message.assistantRunId))
  if (
    !run ||
    run.surface !== 'email' ||
    run.resultMessageId !== message.id ||
    run.conversationId !== message.conversationId
  )
    return
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId))
  if (!conversation) return
  const verdict = await assistantChannelEligibility(conversation, db, run.triggerMessageId)
  const [pair] = await db
    .select({ id: ticketConversations.ticketId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.conversationId, conversation.id),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  const involvement = await getLatestInvolvement(conversation.id)
  const reason = !verdict.eligible
    ? verdict.reason
    : pair
      ? 'paired_ticket'
      : involvement?.status === 'handed_off' && run.outcome !== 'handoff'
        ? 'handed_off'
        : null
  if (reason) {
    await persistChannelDelivery(messageId, {
      status: 'failed',
      channel: 'email',
      error: `Not sent: ${reason.replace(/_/g, ' ')}.`,
    })
    log.info('Autonomous email answer was not sent', { message_id: messageId, reason })
    return
  }

  // The compare-and-set is the dispatch commitment. A lost process can leave
  // an uncertain delivery, but a second worker cannot send another copy.
  const dispatch = { at: new Date().toISOString(), jobId: job.jobId }
  const [claimed] = await db
    .update(conversationMessages)
    .set({
      metadata: sql`COALESCE(${conversationMessages.metadata}, '{}'::jsonb) || ${JSON.stringify({ assistantEmailDispatch: dispatch })}::jsonb`,
    })
    .where(
      and(
        eq(conversationMessages.id, messageId),
        sql`${conversationMessages.metadata}->'assistantEmailDispatch' IS NULL`,
        sql`${conversationMessages.metadata}->'channelDelivery'->>'status' IS DISTINCT FROM 'sent'`
      )
    )
    .returning()
  if (!claimed) return
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
    if (err instanceof EmailNotSentError) {
      // Only an explicit not-sent result permits another attempt.
      await db
        .update(conversationMessages)
        .set({ metadata: sql`${conversationMessages.metadata} - 'assistantEmailDispatch'` })
        .where(
          and(
            eq(conversationMessages.id, messageId),
            sql`${conversationMessages.metadata}->'assistantEmailDispatch' = ${JSON.stringify(dispatch)}::jsonb`
          )
        )
      await persistChannelDelivery(messageId, {
        status: 'failed',
        channel: 'email',
        error: err.message,
      })
      throw err
    }
    await persistChannelDelivery(messageId, {
      status: 'failed',
      channel: 'email',
      error: UNCONFIRMED,
    })
    log.warn('Autonomous email delivery is unconfirmed', {
      message_id: messageId,
      job_id: job.jobId,
    })
    return
  }

  const updated = await db.transaction(async (tx) => {
    const [parent] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
      .for('update')
    const at = new Date()
    const [sent] = await tx
      .update(conversationMessages)
      .set({
        metadata: sql`${conversationMessages.metadata} || ${JSON.stringify({ channelDelivery: { status: 'sent', channel: 'email', at: at.toISOString() } })}::jsonb`,
      })
      .where(eq(conversationMessages.id, messageId))
      .returning()
    const [latest] = await tx
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversation.id),
          eq(conversationMessages.isInternal, false)
        )
      )
      .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
      .limit(1)
    if (
      parent?.status === 'open' &&
      !parent.assignedAgentPrincipalId &&
      latest?.id === message.id &&
      parent.assistantRevision === run.inputRevision &&
      run.outcome !== 'handoff'
    ) {
      const active = await getLatestInvolvement(conversation.id, tx)
      if (active?.status === 'handed_off') return sent
      const answered = run.outcome === 'answer' && active?.status === 'active'
      if (answered)
        await recordAssistantAnswer(active.id, { sources: message.citations ?? [], at }, tx)
      await tx
        .update(conversations)
        .set({
          waitingSince: null,
          inactivityOwner: answered ? 'assistant_answered' : 'assistant_waiting',
          inactivityAnchorAt: at,
          inactivityCheckInAt: null,
          inactivityRetryAt: null,
        })
        .where(eq(conversations.id, conversation.id))
    }
    return sent
  })
  if (updated) await broadcastInboxMessageUpdated(updated)
  log.info('Autonomous email answer delivered', { message_id: messageId, job_id: job.jobId })
}
