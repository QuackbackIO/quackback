/**
 * Whether Quinn may answer this conversation on a channel that is not the
 * messenger (QUINN-PRODUCT P9).
 *
 * The messenger has always been autonomous and stays governed by its own
 * `messenger.assistant.respond` switch. Every other channel is off, and adding
 * a surface name is deliberately NOT what turns one on: an email reply is a
 * message the workspace sends from its own domain to a real mailbox, and the
 * rules below are the difference between that and a widget bubble.
 *
 * ## The rules, and why each one is here
 *
 * 1. **The channel is enabled for Quinn.** An explicit workspace decision,
 *    default off, read live so turning it off stops the next reply.
 * 2. **The sender is verified.** Cold inbound mints an anonymous lead for
 *    anyone who writes in, and marks the conversation `unverifiedSender` when
 *    DMARC did not pass against a known account. Replying to an unverified
 *    sender means answering a question that may have been asked by somebody
 *    pretending to be the customer, from an address we would then write to.
 * 3. **There is a thread to reply into.** The reply is threaded from the
 *    inbound Message-ID this workspace recorded. Without one there is no
 *    In-Reply-To to set and the reply lands as a new thread in the customer's
 *    client, which is not a reply.
 * 4. **There is somewhere to send it.** A conversation with no address on file
 *    cannot be answered by email whatever else is true.
 * 5. **Nobody else owns it.** A quarantined, spam-filed or closed thread is
 *    not Quinn's to answer, and neither is one a teammate has taken.
 *
 * Every rule is a read. The decision is made again on the worker side by the
 * ordinary publication fences, so a rule that changed mid-generation stops the
 * reply the same way a takeover does.
 */
import { and, desc, eq, isNotNull, sql, conversationMessages } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { Conversation } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'

/** Why an email conversation is not eligible, for the run ledger and the tests. */
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

const ELIGIBLE: ChannelEligibility = { eligible: true }

/**
 * Whether a non-messenger conversation may have an autonomous Quinn turn.
 *
 * Only the email channel has rules; every other source is refused by name
 * rather than by omission, so a new source cannot become autonomous by
 * default.
 */
export async function assistantChannelEligibility(
  conversation: Conversation,
  exec: Executor
): Promise<ChannelEligibility> {
  if (conversation.source !== 'email') return { eligible: false, reason: 'unsupported_source' }

  const { getAssistantChannels } =
    await import('@/lib/server/domains/settings/settings.assistant-channels')
  const channels = await getAssistantChannels()
  if (!channels.email.enabled) return { eligible: false, reason: 'channel_disabled' }

  if (isUnverifiedSender(conversation)) return { eligible: false, reason: 'unverified_sender' }
  if (!conversation.visitorEmail) return { eligible: false, reason: 'no_address' }
  if (conversation.status !== 'open' || conversation.endReason === 'spam') {
    return { eligible: false, reason: 'not_open' }
  }
  if (conversation.assignedAgentPrincipalId) return { eligible: false, reason: 'taken_over' }
  if (!(await hasInboundThreadId(conversation.id, exec))) {
    return { eligible: false, reason: 'no_thread' }
  }
  return ELIGIBLE
}

/**
 * The cold-inbound resolver's own verdict, read off the conversation.
 *
 * It sets `unverifiedSender` when it could not match a DMARC-passing sender to
 * an account, which is exactly the case an autonomous reply must not answer.
 */
function isUnverifiedSender(conversation: Conversation): boolean {
  const attributes = conversation.customAttributes as Record<string, unknown> | null
  return attributes?.unverifiedSender === true
}

/**
 * Whether any inbound message on this thread carries the Message-ID the reply
 * would thread from. Written by the email ingest onto the message metadata,
 * which is the authority for email threading in this codebase.
 */
async function hasInboundThreadId(
  conversationId: ConversationId,
  exec: Executor
): Promise<boolean> {
  const [row] = await exec
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNotNull(sql`${conversationMessages.metadata} ->> 'emailMessageId'`)
      )
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(1)
  return !!row
}
