/** One clock and one eligibility calculation for scheduling and execution. */
import {
  db,
  sql,
  eq,
  and,
  conversations,
  conversationMessages,
  assistantInvolvements,
  settings as settingsTable,
} from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import {
  inactivityPolicy,
  DEFAULT_MESSENGER_CHECK_IN_MESSAGE,
  DEFAULT_ASSISTANT_FOLLOW_UP_MESSAGE,
  DEFAULT_MESSENGER_CLOSING_MESSAGE,
  type ConversationInactivitySettings,
} from '@/lib/shared/conversation-inactivity'
import {
  getConversationInactivitySettings,
  resolveConversationInactivity,
} from '@/lib/server/domains/settings/settings.conversation-inactivity'
import { parseWidgetConfig } from '@/lib/server/domains/settings/settings.helpers'
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { isPrincipalOnline } from '@/lib/server/realtime/presence'
import { logger } from '@/lib/server/logger'
import { emit } from '@/lib/server/events/emit'
import { conversationStatusChanged } from '@/lib/server/events/catalogue/conversation'
import { assistantResolved } from '@/lib/server/events/catalogue/assistant'

const log = logger.child({ component: 'conversation-inactivity' })
type Owner = 'team' | 'assistant_answered' | 'assistant_waiting' | 'handoff'
type Candidate = { id: ConversationId; anchor: Date | string; owner: Owner; due_at: Date | string }
type Cursor = { deadline: string; id: string }
export type InactivityState = {
  channel: string
  status: string
  inactivityOwner: Owner | null
  inactivityAnchorAt: Date | null
  inactivityCheckInAt: Date | null
  snoozedUntil?: Date | null
}

export function inactivityAction(
  state: InactivityState,
  settings: ConversationInactivitySettings,
  now: Date
): 'follow_up' | 'close' | null {
  if (
    state.status !== 'open' ||
    state.snoozedUntil ||
    !state.inactivityAnchorAt ||
    !state.inactivityOwner ||
    state.inactivityOwner === 'handoff' ||
    (state.channel !== 'messenger' && state.channel !== 'email')
  )
    return null
  const p = inactivityPolicy(
    settings,
    state.inactivityOwner === 'team' ? 'team' : 'assistant',
    state.channel
  )
  if (p.mode !== 'built_in') return null
  const elapsed = now.getTime() - state.inactivityAnchorAt.getTime()
  const closes =
    p.closeEnabled &&
    (state.inactivityOwner === 'team' ||
      (state.inactivityOwner === 'assistant_answered'
        ? p.closeWhenAnswered
        : p.closeWhenUnanswered))
  if (closes && elapsed >= p.closeMs) return 'close'
  if (
    p.followUpEnabled &&
    state.inactivityOwner !== 'assistant_waiting' &&
    !state.inactivityCheckInAt &&
    elapsed >= p.followUpMs
  )
    return 'follow_up'
  return null
}

/** Same predicates for min(deadline), bounded scans and worker revalidation. */
function dueQuery(
  settings: ConversationInactivitySettings,
  owner?: 'team' | 'assistant',
  action?: 'follow_up' | 'close'
) {
  const arms = []
  for (const channel of ['messenger', 'email'] as const)
    for (const kind of ['team', 'assistant_answered', 'assistant_waiting'] as const) {
      if (owner && (kind === 'team' ? 'team' : 'assistant') !== owner) continue
      const p = inactivityPolicy(settings, kind === 'team' ? 'team' : 'assistant', channel)
      if (p.mode !== 'built_in') continue
      const close =
        action !== 'follow_up' &&
        p.closeEnabled &&
        (kind === 'team' ||
          (kind === 'assistant_answered' ? p.closeWhenAnswered : p.closeWhenUnanswered))
      const follow = action !== 'close' && p.followUpEnabled && kind !== 'assistant_waiting'
      if (!close && !follow) continue
      arms.push(sql`SELECT c.id, c.inactivity_anchor_at AS anchor, c.inactivity_owner AS owner,
      LEAST(${close ? sql`c.inactivity_anchor_at + ${p.closeMs} * interval '1 millisecond'` : sql`NULL::timestamptz`},
        ${follow ? sql`CASE WHEN c.inactivity_check_in_at IS NULL THEN GREATEST(c.inactivity_anchor_at + ${p.followUpMs} * interval '1 millisecond', c.inactivity_retry_at) END` : sql`NULL::timestamptz`}) AS due_at
      FROM conversations c WHERE c.status = 'open' AND c.snoozed_until IS NULL
        AND c.channel = ${channel} AND c.inactivity_owner = ${kind} AND c.inactivity_anchor_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM workflow_runs r WHERE r.conversation_id = c.id AND r.customer_facing AND r.state IN ('running','waiting') AND (r.state = 'running' OR r.cursor->>'waitKind' = 'input'))`)
    }
  return arms.length
    ? sql.join(arms, sql` UNION ALL `)
    : sql`SELECT NULL::text AS id, NULL::timestamptz AS anchor, NULL::text AS owner, NULL::timestamptz AS due_at WHERE false`
}
export async function nextInactivityDeadline(): Promise<Date | null> {
  const settings = await getConversationInactivitySettings()
  const result = await db.execute(
    sql`SELECT min(due_at) AS due_at FROM (${dueQuery(settings)}) due`
  )
  const value = getExecuteRows<{ due_at: Date | string | null }>(result)[0]?.due_at
  return value ? new Date(value) : null
}

export async function sweepInactivity(
  options: {
    now?: Date
    owner?: 'team' | 'assistant'
    action?: 'follow_up' | 'close'
    after?: Cursor
  } = {}
) {
  const now = options.now ?? new Date()
  const settings = await getConversationInactivitySettings()
  const query = dueQuery(settings, options.owner, options.action)
  const rows = getExecuteRows<Candidate>(
    await db.execute(sql`SELECT * FROM (${query}) due WHERE due_at <= ${now.toISOString()}::timestamptz
    ${options.after ? sql`AND (due_at, id) > (${options.after.deadline}::timestamptz, ${options.after.id})` : sql``}
    ORDER BY due_at, id LIMIT 200`)
  )
  const counts = { followedUp: 0, closed: 0, resolved: 0, abandoned: 0, stale: 0 }
  for (const row of rows) {
    try {
      const outcome = await executeInactivity(row, now, options.action)
      if (!outcome) counts.stale++
      else if (outcome === 'follow_up') counts.followedUp++
      else {
        counts.closed++
        if (row.owner === 'assistant_answered') counts.resolved++
        if (row.owner === 'assistant_waiting') counts.abandoned++
      }
    } catch (err) {
      log.warn({ err, conversationId: row.id }, 'inactivity action failed; eligible for retry')
    }
  }
  if (rows.length === 200) {
    const last = rows.at(-1)!
    await enqueueJob({
      queue: 'conversation-inactivity-continuation',
      payload: {
        ...options,
        now: now.toISOString(),
        after: { deadline: new Date(last.due_at).toISOString(), id: last.id },
      },
      dedupeKey: `${now.toISOString()}:${options.owner ?? 'all'}:${options.action ?? 'all'}:${last.id}`,
      maxAttempts: 3,
    })
  }
  log.info(counts, 'inactivity batch complete')
  return counts
}

async function executeInactivity(
  candidate: Candidate,
  now: Date,
  requestedAction?: 'follow_up' | 'close'
) {
  // Presence is advisory; all consequential state is read again under the lock.
  const [visitor] = await db
    .select({ id: conversations.visitorPrincipalId, channel: conversations.channel })
    .from(conversations)
    .where(eq(conversations.id, candidate.id))
    .limit(1)
  if (!visitor) return null
  const online =
    candidate.owner === 'team' && visitor.channel === 'messenger'
      ? await isPrincipalOnline(visitor.id)
      : true
  return db.transaction(async (tx) => {
    const [workspace] = await tx.select().from(settingsTable).limit(1).for('share')
    const settings = resolveConversationInactivity(workspace.metadata)
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, candidate.id))
      .for('update', { skipLocked: true })
    if (
      !conversation ||
      conversation.inactivityOwner !== candidate.owner ||
      conversation.inactivityAnchorAt?.getTime() !== new Date(candidate.anchor).getTime()
    )
      return null
    const protectedRuns = getExecuteRows(
      await tx.execute(
        sql`SELECT 1 FROM workflow_runs WHERE conversation_id = ${candidate.id} AND customer_facing AND state IN ('running','waiting') AND (state = 'running' OR cursor->>'waitKind' = 'input') LIMIT 1`
      )
    )
    if (protectedRuns.length) return null
    const action = inactivityAction(conversation, settings, now)
    if (!action || (requestedAction && requestedAction !== action)) return null
    if (
      action === 'follow_up' &&
      conversation.channel === 'messenger' &&
      candidate.owner === 'team' &&
      !online
    ) {
      await tx
        .update(conversations)
        .set({ inactivityRetryAt: new Date(now.getTime() + 60_000) })
        .where(eq(conversations.id, conversation.id))
      return null
    }
    const group = conversation.channel as 'messenger' | 'email'
    const owner = candidate.owner === 'team' ? 'team' : 'assistant'
    const policy = inactivityPolicy(settings, owner, group)
    const preventReplies =
      group === 'messenger' &&
      parseWidgetConfig(workspace.widgetConfig).messenger?.preventRepliesWhenClosed === true
    const custom = action === 'close' ? policy.closingMessage : policy.followUpMessage
    // Historical default text is still a built-in default, not an override.
    const customText = !!custom.trim() && custom !== DEFAULT_MESSENGER_CLOSING_MESSAGE
    const content = customText
      ? custom
      : action === 'close'
        ? `This conversation has been closed. ${preventReplies ? 'Start a new conversation' : 'Reply to reopen'} if you still need help.`
        : owner === 'team'
          ? DEFAULT_MESSENGER_CHECK_IN_MESSAGE
          : policy.purpose === 'offer_human_help'
            ? 'Still need help? Reply here and I can connect you with the team.'
            : DEFAULT_ASSISTANT_FOLLOW_UP_MESSAGE
    const key = `${conversation.id}:${conversation.inactivityAnchorAt!.toISOString()}:${candidate.owner}:${action}`
    const mail = group === 'email' && (action === 'follow_up' || owner === 'assistant')
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        senderType: 'system',
        principalId: null,
        content,
        metadata: {
          inactivity: {
            key,
            anchor: conversation.inactivityAnchorAt!.toISOString(),
            owner: candidate.owner,
            action,
          },
          systemEvent: {
            kind:
              action === 'follow_up'
                ? 'inactivity_check_in'
                : owner === 'assistant'
                  ? 'assistant_auto_closed'
                  : 'auto_closed_inactive',
            customText,
            preventReplies,
            ...(owner === 'assistant' && action === 'follow_up'
              ? { followUpPurpose: policy.purpose }
              : {}),
          },
          ...(mail
            ? {
                channelDelivery: {
                  channel: 'email' as const,
                  status: 'pending' as const,
                  at: now.toISOString(),
                },
              }
            : {}),
        },
      })
      .returning()
    if (action === 'follow_up') {
      await tx
        .update(conversations)
        // The follow-up is a new Quinn utterance, so it invalidates any turn
        // still generating over the older state (QUINN-PRODUCT P2).
        .set({
          inactivityCheckInAt: now,
          inactivityRetryAt: null,
          assistantRevision: sql`${conversations.assistantRevision} + 1`,
        })
        .where(eq(conversations.id, conversation.id))
      if (owner === 'assistant')
        await tx
          .update(assistantInvolvements)
          .set({ followUpSentAt: now })
          .where(
            and(
              eq(assistantInvolvements.conversationId, conversation.id),
              eq(assistantInvolvements.status, 'active')
            )
          )
    } else {
      await tx
        .update(conversations)
        .set({
          status: 'closed',
          resolvedAt: now,
          waitingSince: null,
          snoozedUntil: null,
          endReason: candidate.owner === 'assistant_answered' ? 'resolved' : 'no_response',
          assistantRevision: sql`${conversations.assistantRevision} + 1`,
          updatedAt: now,
        })
        .where(eq(conversations.id, conversation.id))
      if (owner === 'assistant')
        await tx
          .update(assistantInvolvements)
          .set({
            status: candidate.owner === 'assistant_answered' ? 'resolved_assumed' : 'abandoned',
            endedAt: now,
          })
          .where(
            and(
              eq(assistantInvolvements.conversationId, conversation.id),
              eq(assistantInvolvements.status, 'active')
            )
          )
      await emit(tx, conversationStatusChanged, {
        entityId: conversation.id,
        actor: { type: 'system' },
        dedupeKey: `${key}:status`,
        payload: {
          conversation: {
            id: conversation.id,
            status: 'closed',
            channel: conversation.channel,
            priority: conversation.priority,
            assignedTeamId: conversation.assignedTeamId,
          },
          previousStatus: 'open',
          newStatus: 'closed',
        },
      })
      if (candidate.owner === 'assistant_answered')
        await emit(tx, assistantResolved, {
          entityId: conversation.id,
          actor: { type: 'system' },
          dedupeKey: `${key}:outcome`,
          payload: { conversationId: conversation.id, outcome: 'resolved_assumed' },
        })
    }
    await enqueueJob({
      queue: 'conversation-inactivity-delivery',
      payload: { messageId: message.id, mail, channel: group },
      dedupeKey: key,
      maxAttempts: 8,
      executor: tx,
    })
    return action
  })
}

export { deliverInactivity } from './conversation.inactivity-delivery'

export async function continueInactivity(job: ClaimedJob): Promise<void> {
  await sweepInactivity({
    now: new Date(job.payload.now as string),
    owner: job.payload.owner as 'team' | 'assistant' | undefined,
    action: job.payload.action as 'follow_up' | 'close' | undefined,
    after: job.payload.after as Cursor,
  })
}
