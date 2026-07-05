/**
 * Apply-SLA (support platform §4.6): stamp a policy's clocks onto a conversation
 * and open its timeline. An SLA is applied ONLY here — the Apply-SLA workflow
 * action calls this; it is never matched ambiently. The computed deadlines are
 * office-hours aware and SNAPSHOT the policy's targets, so a later edit to the
 * policy never moves a clock that is already running on a live conversation.
 * Lazy breach evaluation (the next sub-step) reads `sla_applied` and appends to
 * the append-only `sla_events` log.
 */
import {
  db,
  eq,
  conversations,
  slaEvents,
  type Conversation,
  type SlaPolicy,
} from '@/lib/server/db'
import type { ConversationId, SlaPolicyId } from '@quackback/ids'
import { getSlaPolicy } from './sla-policy.service'
import {
  addOfficeHoursSeconds,
  getScheduleById,
  getDefaultSchedule,
} from '../office-hours/office-hours.service'

/**
 * The `conversations.sla_applied` shape: the one active SLA on a conversation.
 * A `type` (not `interface`) so it stays assignable to the column's
 * `Record<string, unknown>` json type.
 */
export type SlaApplied = {
  policyId: SlaPolicyId
  // Snapshot for display without a join back to the (possibly edited/deleted) policy.
  policyName: string
  appliedAt: string // ISO
  // Absolute, office-hours-aware deadlines; null = that clock is untracked by the
  // policy. The next-response clock restarts on every customer message, so only
  // its target (seconds) is snapshotted — the evaluator computes its due time.
  firstResponseDueAt: string | null
  nextResponseTargetSecs: number | null
  timeToCloseDueAt: string | null
  // Lazy-eval outcomes: when the first teammate reply / the resolution landed
  // (set by the breach evaluator), or null while that clock is still open.
  firstResponseAt?: string | null
  resolvedAt?: string | null
  // Snapshot of the policy's pause rule so the inbox chip can show a paused
  // state without a join back to the policy. Stamps written before this field
  // existed read as true (the policy default).
  pauseOnSnooze?: boolean
}

/**
 * The schedule a policy's clocks run on: its pinned schedule, else the workspace
 * default, else a 24/7 fallback — an unconfigured workspace never blocks a clock.
 */
async function resolveScheduleFor(
  policy: SlaPolicy
): Promise<{ timezone: string; intervals: { day: number; start: string; end: string }[] }> {
  const schedule = policy.officeHoursScheduleId
    ? await getScheduleById(policy.officeHoursScheduleId)
    : await getDefaultSchedule()
  return schedule ?? { timezone: 'UTC', intervals: [] }
}

/**
 * Apply a policy to a conversation: compute the deadlines, stamp `sla_applied`,
 * and log an 'applied' event. Re-applying replaces the active SLA (one per
 * conversation). `at` is injectable so callers/tests pin the clock origin.
 */
export async function applySlaToConversation(
  conversationId: ConversationId,
  policyId: SlaPolicyId,
  at: Date = new Date()
): Promise<SlaApplied> {
  const policy = await getSlaPolicy(policyId)
  if (!policy) throw new Error(`SLA policy ${policyId} not found`)
  const schedule = await resolveScheduleFor(policy)

  const applied: SlaApplied = {
    policyId: policy.id,
    policyName: policy.name,
    appliedAt: at.toISOString(),
    firstResponseDueAt: policy.firstResponseTargetSecs
      ? addOfficeHoursSeconds(schedule, at, policy.firstResponseTargetSecs).toISOString()
      : null,
    nextResponseTargetSecs: policy.nextResponseTargetSecs ?? null,
    timeToCloseDueAt: policy.timeToCloseTargetSecs
      ? addOfficeHoursSeconds(schedule, at, policy.timeToCloseTargetSecs).toISOString()
      : null,
    firstResponseAt: null,
    pauseOnSnooze: policy.pauseOnSnooze,
  }

  await db
    .update(conversations)
    .set({ slaApplied: applied, updatedAt: at })
    .where(eq(conversations.id, conversationId))

  await db.insert(slaEvents).values({
    conversationId,
    policyId: policy.id,
    kind: 'applied',
    meta: {
      firstResponseDueAt: applied.firstResponseDueAt,
      timeToCloseDueAt: applied.timeToCloseDueAt,
    },
  })

  return applied
}

/** The active SLA stamped on a conversation, or null when none is applied. */
async function loadSlaApplied(conversationId: ConversationId): Promise<SlaApplied | null> {
  const [row] = await db
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return (row?.slaApplied as SlaApplied | undefined) ?? null
}

/** Persist a mutated stamp + append one clock event in a single spot (both writes
 *  always travel together, so callers never leave the stamp and log out of sync). */
async function commitClockEvent(
  conversationId: ConversationId,
  next: SlaApplied,
  kind: string,
  dueAt: string,
  at: Date
): Promise<void> {
  const overdueMs = at.getTime() - new Date(dueAt).getTime()
  await db
    .update(conversations)
    .set({ slaApplied: next, updatedAt: at })
    .where(eq(conversations.id, conversationId))
  await db.insert(slaEvents).values({
    conversationId,
    policyId: next.policyId,
    kind,
    meta: { dueAt, at: at.toISOString(), overdueSecs: Math.max(0, Math.round(overdueMs / 1000)) },
  })
}

/**
 * Record the first teammate reply against the first-response clock and log
 * met/breached. Idempotent (only the first reply counts) and a no-op when no SLA
 * is applied or the policy doesn't track first response. Note: pause-on-snooze is
 * not yet reflected — the clock is the absolute deadline stamped at apply.
 */
export async function recordFirstResponse(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  const applied = await loadSlaApplied(conversationId)
  if (!applied || !applied.firstResponseDueAt || applied.firstResponseAt) return
  const breached = at.getTime() > new Date(applied.firstResponseDueAt).getTime()
  await commitClockEvent(
    conversationId,
    { ...applied, firstResponseAt: at.toISOString() },
    breached ? 'first_response_breached' : 'first_response_met',
    applied.firstResponseDueAt,
    at
  )
}

/**
 * Record the conversation's resolution against the time-to-close clock and log
 * met/breached. Idempotent and a no-op when no SLA is applied or the policy
 * doesn't track time-to-close.
 */
export async function recordResolution(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  const applied = await loadSlaApplied(conversationId)
  if (!applied || !applied.timeToCloseDueAt || applied.resolvedAt) return
  const breached = at.getTime() > new Date(applied.timeToCloseDueAt).getTime()
  await commitClockEvent(
    conversationId,
    { ...applied, resolvedAt: at.toISOString() },
    breached ? 'resolution_breached' : 'resolution_met',
    applied.timeToCloseDueAt,
    at
  )
}

/**
 * Manually remove the active SLA (the agent's overflow action): clear the
 * stamp and log a 'removed' event so reporting can tell removal apart from
 * completion. A no-op (null) when nothing is applied; otherwise returns the
 * updated row so the caller can broadcast the fresh DTO.
 */
export async function removeSlaFromConversation(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<Conversation | null> {
  const applied = await loadSlaApplied(conversationId)
  if (!applied) return null
  const [row] = await db
    .update(conversations)
    .set({ slaApplied: null, updatedAt: at })
    .where(eq(conversations.id, conversationId))
    .returning()
  await db.insert(slaEvents).values({
    conversationId,
    policyId: applied.policyId,
    kind: 'removed',
    meta: { at: at.toISOString() },
  })
  return row ?? null
}
