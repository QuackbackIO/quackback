/**
 * Assistant involvement service — the audit/KPI unit for Quinn.
 *
 * One `assistant_involvements` row per conversation Quinn engages. The locked
 * outcome semantics live here as pure, unit-tested functions; persistence is a
 * thin layer over them. The inactivity sweep records assumed / abandoned
 * outcomes and, when settings allow, closes the conversation.
 */
import {
  db,
  assistantInvolvements,
  conversations,
  and,
  eq,
  desc,
  sql,
  type AssistantInvolvementSource,
  type AssistantInvolvementStatus,
  type AssistantInvolvementTrigger,
  type AssistantHandoffReason,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { logger } from '@/lib/server/logger'
import type { AssistantInvolvementId, ConversationId } from '@quackback/ids'
export type AssistantInvolvement = typeof assistantInvolvements.$inferSelect

const log = logger.child({ component: 'assistant-involvement' })

/**
 * Inactivity window before a thread with no customer reply after Quinn's last
 * answer is assumed resolved. The stale-involvement sweep
 * (`finalizeStaleAssistantInvolvements`) trips it; the pure eligibility rule
 * defaults to the same window. Single source for both.
 */
export const ASSUMED_RESOLUTION_INACTIVITY_MINUTES = 15

/**
 * The Quinn-inbox buckets, mapped to involvement lifecycle statuses — the
 * outcome vocabulary the "Quinn AI" inbox view filters and counts by.
 */
export const AI_INBOX_BUCKETS = {
  resolved: ['resolved_confirmed', 'resolved_assumed'],
  escalated: ['handed_off'],
  pending: ['active'],
  abandoned: ['abandoned'],
} as const satisfies Record<string, AssistantInvolvementStatus[]>

export type AiInboxBucket = keyof typeof AI_INBOX_BUCKETS

/**
 * Conversation-count per Quinn-inbox bucket, for the inbox nav badges. One
 * grouped scan of `assistant_involvements` (there is one row per conversation
 * Quinn engaged), folded into the three buckets.
 */
export async function countAssistantInboxBuckets(
  exec: Executor = db
): Promise<Record<AiInboxBucket, number>> {
  const rows = await exec
    .select({ status: assistantInvolvements.status, n: sql<number>`count(*)::int` })
    .from(assistantInvolvements)
    .groupBy(assistantInvolvements.status)
  const byStatus = new Map(rows.map((r) => [r.status, r.n]))
  const sum = (statuses: readonly AssistantInvolvementStatus[]) =>
    statuses.reduce((total, s) => total + (byStatus.get(s) ?? 0), 0)
  return {
    resolved: sum(AI_INBOX_BUCKETS.resolved),
    escalated: sum(AI_INBOX_BUCKETS.escalated),
    pending: sum(AI_INBOX_BUCKETS.pending),
    abandoned: sum(AI_INBOX_BUCKETS.abandoned),
  }
}

// --------------------------------------------------------------- pure rules ---

/** Context the outcome rules reason over (all supplied by the caller). */
export interface OutcomeContext {
  /** Quinn produced a substantive answer this involvement (a greeting is not one). */
  gaveRealAnswer: boolean
  /** Minutes since the customer's last activity after Quinn's real answer. */
  inactivityMinutes: number
  /** The customer came back needing help after the assumed window. */
  customerReturned: boolean
}

/**
 * Whether an assumed resolution may be recorded: only after a real answer,
 * only past the inactivity window, and never once the customer has returned
 * needing help (which voids it).
 */
export function assumedResolutionEligible(
  ctx: OutcomeContext,
  thresholdMinutes: number = ASSUMED_RESOLUTION_INACTIVITY_MINUTES
): boolean {
  if (!ctx.gaveRealAnswer) return false
  if (ctx.customerReturned) return false
  return ctx.inactivityMinutes >= thresholdMinutes
}

/** Whether a confirmed resolution may be recorded: a real answer the customer explicitly affirmed. */
export function confirmedResolutionEligible(ctx: {
  gaveRealAnswer: boolean
  explicitAffirmation: boolean
}): boolean {
  return ctx.gaveRealAnswer && ctx.explicitAffirmation
}

/** The terminal status for a recorded outcome. */
export function outcomeStatus(kind: 'confirmed' | 'assumed'): AssistantInvolvementStatus {
  return kind === 'confirmed' ? 'resolved_confirmed' : 'resolved_assumed'
}

// -------------------------------------------------------------- persistence ---

/** Reuse the active involvement, or atomically open a new one. */
export async function openInvolvement(
  input: { conversationId: ConversationId; triggeredBy: AssistantInvolvementTrigger },
  exec: Executor = db
): Promise<AssistantInvolvement> {
  // The parent lock also works before the unique index is rolled out and
  // joins an existing intake transaction via a savepoint when supplied one.
  return exec.transaction(async (tx) => {
    const [parent] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .for('update')
    if (!parent) throw new Error('Cannot open an involvement for a missing conversation')
    const existing = await getActiveInvolvement(input.conversationId, tx)
    if (existing) return existing
    const [row] = await tx
      .insert(assistantInvolvements)
      .values({ conversationId: input.conversationId, triggeredBy: input.triggeredBy })
      .returning()
    return row
  })
}

/** The currently-active involvement for a conversation, or null. */
export async function getActiveInvolvement(
  conversationId: ConversationId,
  exec: Executor = db
): Promise<AssistantInvolvement | null> {
  const [row] = await exec
    .select()
    .from(assistantInvolvements)
    .where(
      and(
        eq(assistantInvolvements.conversationId, conversationId),
        eq(assistantInvolvements.status, 'active')
      )
    )
    .orderBy(desc(assistantInvolvements.createdAt))
    .limit(1)
  return row ?? null
}

/** The most recent involvement for a conversation regardless of status, or null. */
export async function getLatestInvolvement(
  conversationId: ConversationId,
  exec: Executor = db
): Promise<AssistantInvolvement | null> {
  const [row] = await exec
    .select()
    .from(assistantInvolvements)
    .where(eq(assistantInvolvements.conversationId, conversationId))
    .orderBy(desc(assistantInvolvements.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * Record the outcome of one answered turn on the involvement in a single UPDATE:
 * the sources Quinn cited and the substantive-answer time (the inactivity
 * clock the stale-involvement sweep reads). Handoff is a separate tool-led
 * terminal operation and is recorded through recordHandoff.
 */
export async function recordAssistantAnswer(
  id: AssistantInvolvementId,
  input: { sources: AssistantInvolvementSource[]; at?: Date },
  exec: Executor = db
): Promise<void> {
  const at = input.at ?? new Date()
  await exec
    .update(assistantInvolvements)
    .set({
      sources: input.sources,
      lastAssistantAnswerAt: at,
      followUpSentAt: null,
    })
    .where(eq(assistantInvolvements.id, id))
}

/**
 * Record a hand-off: Quinn decided THAT it escalates and why (never WHERE).
 * Returns the updated row, or null when the involvement was no longer active —
 * the same conditional-UPDATE guard as recordOutcome, so concurrent turns
 * cannot double-record a handoff. Callers must skip the conversation-side
 * handoff effects (system message, routing, events) on null.
 */
export async function recordHandoff(
  id: AssistantInvolvementId,
  reason: AssistantHandoffReason,
  exec: Executor = db
): Promise<AssistantInvolvement | null> {
  const [row] = await exec
    .update(assistantInvolvements)
    .set({ status: 'handed_off', handoffReason: reason, endedAt: new Date() })
    .where(and(eq(assistantInvolvements.id, id), eq(assistantInvolvements.status, 'active')))
    .returning()
  if (row)
    await exec
      .update(conversations)
      .set({ inactivityOwner: 'handoff', inactivityAnchorAt: null, inactivityCheckInAt: null })
      .where(
        and(
          eq(conversations.id, row.conversationId),
          sql`${conversations.inactivityOwner} IN ('assistant_answered', 'assistant_waiting')`
        )
      )
  return row ?? null
}

/**
 * Record a resolution outcome — at most one per conversation. Returns the
 * updated row, or null if a terminal outcome was already recorded (the
 * at-most-one guard, enforced with a conditional UPDATE so concurrent callers
 * cannot double-record).
 */
export async function recordOutcome(
  id: AssistantInvolvementId,
  kind: 'confirmed' | 'assumed',
  exec: Executor = db
): Promise<AssistantInvolvement | null> {
  const [row] = await exec
    .update(assistantInvolvements)
    .set({ status: outcomeStatus(kind), endedAt: new Date() })
    .where(
      and(
        eq(assistantInvolvements.id, id),
        // Only a non-terminal involvement can be resolved (at most one outcome).
        eq(assistantInvolvements.status, 'active')
      )
    )
    .returning()
  if (row) {
    await dispatchResolvedEvent(row.conversationId, row.status, row.id)
  }
  return row ?? null
}

async function dispatchResolvedEvent(
  conversationId: ConversationId,
  status: AssistantInvolvementStatus,
  involvementId?: AssistantInvolvementId
): Promise<void> {
  try {
    const { dispatchAssistantResolved, buildEventActor } =
      await import('@/lib/server/events/dispatch')
    const { ensureAssistantPrincipal } =
      await import('@/lib/server/domains/assistant/assistant.principal')
    const assistant = await ensureAssistantPrincipal()
    await dispatchAssistantResolved(
      buildEventActor({
        principalId: assistant.id,
        displayName: assistant.displayName ?? undefined,
      }),
      conversationId,
      status
    )
  } catch (err) {
    log.warn({ err, id: involvementId }, 'assistant.resolved dispatch failed')
  }
}

/**
 * Positive end of the 1-5 CSAT scale — the threshold treated as the customer's
 * explicit affirmation of Quinn's answer.
 */
const POSITIVE_CSAT_RATING = 4

/**
 * Resolve Quinn's active involvement as confirmed off a positive CSAT rating
 * when it already gave a real answer. Subscribed to conversation.csat_submitted
 * (events/process.ts), which fires only on the first submission — a later
 * rating change does not re-run it. No-op without an active involvement, one
 * Quinn hasn't yet answered, or a rating below the positive threshold.
 * Best-effort: a failure never surfaces to the CSAT submission that raised it.
 */
export async function confirmResolutionFromCsat(
  conversationId: ConversationId,
  rating: number
): Promise<void> {
  try {
    const involvement = await getActiveInvolvement(conversationId)
    if (!involvement?.lastAssistantAnswerAt) return
    const eligible = confirmedResolutionEligible({
      gaveRealAnswer: true,
      explicitAffirmation: rating >= POSITIVE_CSAT_RATING,
    })
    if (!eligible) return
    await recordOutcome(involvement.id, 'confirmed')
  } catch (err) {
    log.warn({ err }, 'confirm resolution from csat failed')
  }
}

/**
 * Revive any assumed-resolved involvement on a conversation back to active — the
 * customer came back needing help, so Quinn re-engages within the same
 * involvement rather than opening a new one. Returns the revived row, which the
 * turn orchestrator reuses AS the active involvement (skipping a second lookup),
 * or null when there was nothing to revive.
 */
export async function voidAssumedResolutionForConversation(
  conversationId: ConversationId,
  exec: Executor = db
): Promise<AssistantInvolvement | null> {
  const [row] = await exec
    .update(assistantInvolvements)
    .set({ status: 'active', endedAt: null })
    .where(
      and(
        eq(assistantInvolvements.conversationId, conversationId),
        eq(assistantInvolvements.status, 'resolved_assumed')
      )
    )
    .returning()
  return row ?? null
}

/**
 * Sweep stale Quinn involvements: assumed-resolve threads that went quiet
 * after a real answer, and abandon threads that never got one. Then close
 * the conversation itself (unless a human has already spoken, or it is
 * already closed/snoozed). Returns how many involvements flipped. Called
 * from the periodic snooze-sweep tick.
 */
export async function finalizeStaleAssistantInvolvements(
  _thresholdMinutes?: number,
  _exec: Executor = db
): Promise<{ resolved: number; abandoned: number }> {
  const { sweepInactivity } =
    await import('@/lib/server/domains/conversation/conversation.inactivity')
  const result = await sweepInactivity({ owner: 'assistant', action: 'close' })
  return { resolved: result.resolved, abandoned: result.abandoned }
}

export async function sendStaleAssistantFollowUps(_exec: Executor = db): Promise<number> {
  const { sweepInactivity } =
    await import('@/lib/server/domains/conversation/conversation.inactivity')
  return (await sweepInactivity({ owner: 'assistant', action: 'follow_up' })).followedUp
}

/** Attach a CSAT rating (recorded when Quinn was the last handler). */
export async function setInvolvementRating(
  id: AssistantInvolvementId,
  rating: number,
  exec: Executor = db
): Promise<void> {
  await exec.update(assistantInvolvements).set({ rating }).where(eq(assistantInvolvements.id, id))
}
