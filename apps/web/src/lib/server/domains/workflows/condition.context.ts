/**
 * The condition-context resolver (§4.6, Slice 4): reads the DB once to build the
 * `ConditionContext` snapshot the pure evaluator reads. The engine resolves this
 * once per trigger and reuses it across every condition in the workflow, so
 * evaluation stays DB-free and the snapshot is a single consistent instant.
 *
 * The triggering message (if any) is passed in by the caller — it comes from the
 * trigger event, not a query — so a "message contains X" condition sees the
 * message that fired the workflow, not merely the conversation's latest.
 */
import { db, eq, conversations } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import { listTagsForConversation } from '@/lib/server/domains/conversation/conversation-tag.service'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'
import { getOfficeHoursSchedule } from '@/lib/server/domains/settings/settings.office-hours'
import { isWithinOfficeHours } from '@/lib/shared/office-hours'
import type { ConditionContext } from './condition.evaluator'

/**
 * Build the condition snapshot for a conversation at instant `at` (default now).
 * Returns null when the conversation is gone. `opts.message` is the triggering
 * message body, if the trigger carried one.
 */
export async function resolveConditionContext(
  conversationId: ConversationId,
  opts: { message?: { body: string; senderType?: 'visitor' | 'agent' } | null; at?: Date } = {}
): Promise<ConditionContext | null> {
  const at = opts.at ?? new Date()
  const [conv] = await db
    .select({
      status: conversations.status,
      channel: conversations.channel,
      priority: conversations.priority,
      waitingSince: conversations.waitingSince,
      csatRating: conversations.csatRating,
      visitorPrincipalId: conversations.visitorPrincipalId,
      customAttributes: conversations.customAttributes,
      assignedTeamId: conversations.assignedTeamId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conv) return null

  // Independent reads — run them together. Office hours come from the
  // workspace settings-blob schedule (the canonical hours source), evaluated
  // 24/7-open when disabled.
  const [tags, segmentIds, officeHoursSchedule] = await Promise.all([
    listTagsForConversation(conversationId),
    segmentIdsForPrincipal(conv.visitorPrincipalId),
    getOfficeHoursSchedule(),
  ])
  const officeHours = isWithinOfficeHours(officeHoursSchedule, at)

  const waitingMinutes = conv.waitingSince
    ? Math.max(0, Math.floor((at.getTime() - conv.waitingSince.getTime()) / 60000))
    : null

  return {
    conversation: {
      status: conv.status,
      channel: conv.channel,
      priority: conv.priority,
      waitingMinutes,
      tagIds: tags.map((t) => t.id),
      assignedTeamId: conv.assignedTeamId,
      // Raw envelopes; conversation.attr.<key> predicates unwrap on read.
      attributes: conv.customAttributes ?? {},
    },
    message: opts.message ?? null,
    person: { segmentIds: [...segmentIds] },
    officeHours,
    csatRating: conv.csatRating ?? null,
  }
}
