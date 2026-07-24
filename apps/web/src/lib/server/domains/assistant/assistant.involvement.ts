/**
 * Assistant involvement service — the audit/KPI unit for Quinn.
 *
 * One `assistant_involvements` row per conversation Quinn engages. The locked
 * outcome semantics (converged across the market references) live here as pure,
 * unit-tested functions; persistence is a thin layer over them. The inactivity
 * TIMER that drives an assumed resolution is wired in the next wave — this wave
 * only encodes the rule that decides whether one may be recorded.
 */
import {
  db,
  assistantInvolvements,
  conversationMessages,
  and,
  eq,
  gt,
  lt,
  isNull,
  notExists,
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
import { classifyConversationAttributes } from '@/lib/server/domains/conversation-attributes/ai-classification.service'

const log = logger.child({ component: 'assistant-involvement' })

export type AssistantInvolvement = typeof assistantInvolvements.$inferSelect

/**
 * Inactivity window before a thread with no customer reply after Quinn's last
 * answer is assumed resolved. The stale-involvement sweep
 * (`finalizeStaleAssistantInvolvements`) trips it; the pure eligibility rule
 * defaults to the same window. Single source for both.
 */
export const ASSUMED_RESOLUTION_INACTIVITY_MINUTES = 10

/**
 * The Quinn-inbox buckets, mapped to involvement lifecycle statuses — the
 * outcome vocabulary the "Quinn AI" inbox view filters and counts by (mirrors
 * Fin's Resolved / Escalated / Pending folder views).
 */
export const AI_INBOX_BUCKETS = {
  resolved: ['resolved_confirmed', 'resolved_assumed'],
  escalated: ['handed_off'],
  pending: ['active'],
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

/** Open a fresh involvement for a conversation Quinn is engaging. */
export async function openInvolvement(
  input: { conversationId: ConversationId; triggeredBy: AssistantInvolvementTrigger },
  exec: Executor = db
): Promise<AssistantInvolvement> {
  const [row] = await exec
    .insert(assistantInvolvements)
    .values({ conversationId: input.conversationId, triggeredBy: input.triggeredBy })
    .returning()
  return row
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
  return row ?? null
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
 * Sweep active involvements whose last answer has gone quiet and record an
 * assumed resolution on each, in one set-based UPDATE. An involvement qualifies
 * when it is still active (the at-most-one guard — a resolved/handed-off one is
 * excluded), its last real answer is older than the inactivity window (a NULL
 * answer time fails the `<` and is excluded too), and no non-deleted customer
 * message has arrived since (a later one means they returned needing help, which
 * voids the assumption). Returns how many were resolved. Called from the
 * periodic snooze-sweep tick.
 */
export async function finalizeStaleAssistantInvolvements(
  thresholdMinutes: number = ASSUMED_RESOLUTION_INACTIVITY_MINUTES,
  exec: Executor = db
): Promise<{ resolved: number }> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000)
  const laterCustomerMessage = exec
    .select({ one: sql`1` })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, assistantInvolvements.conversationId),
        eq(conversationMessages.senderType, 'visitor'),
        isNull(conversationMessages.deletedAt),
        gt(conversationMessages.createdAt, assistantInvolvements.lastAssistantAnswerAt)
      )
    )
  const resolvedRows = await exec
    .update(assistantInvolvements)
    .set({ status: 'resolved_assumed', endedAt: new Date() })
    .where(
      and(
        eq(assistantInvolvements.status, 'active'),
        lt(assistantInvolvements.lastAssistantAnswerAt, cutoff),
        notExists(laterCustomerMessage)
      )
    )
    .returning({
      id: assistantInvolvements.id,
      conversationId: assistantInvolvements.conversationId,
    })
  // AI attribute classification (AI-ATTRIBUTES-PARITY-SPEC.md Phase 1): the
  // inactivity "job done" moment. Fire-and-forget per conversation — the
  // classifier is itself flag-gated and never throws, so this never slows
  // down or risks the sweep tick itself; the extra catch here is defense in
  // depth in case that contract is ever violated.
  for (const row of resolvedRows) {
    void classifyConversationAttributes(row.conversationId, { trigger: 'inactivity' }).catch(
      (err) => {
        log.warn(
          { err, conversationId: row.conversationId },
          'inactivity-close attribute classification failed'
        )
      }
    )
  }
  return { resolved: resolvedRows.length }
}

/** Attach a CSAT rating (recorded when Quinn was the last handler). */
export async function setInvolvementRating(
  id: AssistantInvolvementId,
  rating: number,
  exec: Executor = db
): Promise<void> {
  await exec.update(assistantInvolvements).set({ rating }).where(eq(assistantInvolvements.id, id))
}
