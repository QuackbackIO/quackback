/**
 * Apply-SLA (support platform §4.6): stamp a policy's clocks onto a conversation
 * and open its timeline. An SLA is applied ONLY here — the Apply-SLA workflow
 * action calls this; it is never matched ambiently. The computed deadlines are
 * office-hours aware and SNAPSHOT the policy's targets, so a later edit to the
 * policy never moves a clock that is already running on a live conversation.
 * Lazy breach evaluation (the next sub-step) reads `sla_applied` and appends to
 * the append-only `sla_events` log.
 */
import { db, eq, conversations, slaEvents, type SlaPolicy } from '@/lib/server/db'
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
  // Lazy-eval outcome: when the first teammate reply landed (set by the breach
  // evaluator), or null while still waiting.
  firstResponseAt?: string | null
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
