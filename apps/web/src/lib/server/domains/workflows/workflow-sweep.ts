/**
 * Workflow run sweeper (support platform §4.6, durable-wait recovery). A run
 * is durable only at wait boundaries, which leaves two stranding modes with
 * no recovery path otherwise: a process crash mid-run leaves a row stuck in
 * state 'running' forever, holding the customer_facing exclusive lock on its
 * conversation; and if Redis was down when a wait was scheduled, or its job
 * was lost, a 'waiting' row has no timer and never resumes. This module scans
 * for both and reconciles them, plus a third pass (abandoned-journey
 * auto-close) below; workflow-sweep-queue runs it on a repeating timer.
 */
import {
  db,
  and,
  eq,
  lt,
  gt,
  lte,
  asc,
  sql,
  isNull,
  isNotNull,
  inArray,
  workflowRuns,
  workflows,
  conversations,
  conversationMessages,
  principal,
  user,
  type WorkflowRun,
  type Workflow,
} from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { realEmail } from '@/lib/shared/anonymous-email'
import { mapWithConcurrency } from '@/lib/server/utils'
import { logger } from '@/lib/server/logger'
import { settleRunning } from './workflow.engine'
import { logRunEvent } from './workflow-run-events'
import { setConversationStatus } from '@/lib/server/domains/conversation/conversation.service'
import { resolveReplyRecipient } from '@/lib/server/domains/conversation/conversation.recipient'
import { getWorkflowAbandonedAutoCloseSettings } from '@/lib/server/domains/settings/settings.workflows'
import {
  getWorkflowWaitJob,
  scheduleWorkflowResume,
  workflowWaitJobId,
  readCursor,
  type WaitCursor,
} from './workflow-wait-queue'
import {
  DEFAULT_INACTIVITY_MINUTES,
  DEFAULT_BREACH_LEAD_MINUTES,
  parseInactivityMinutes,
  parseBreachLeadMinutes,
} from './workflow.schemas'
import {
  dispatchConversationCustomerUnresponsive,
  dispatchConversationTeammateUnresponsive,
  dispatchSlaApproachingBreach,
  dispatchSlaBreached,
} from '@/lib/server/events/dispatch'
import {
  sweepApproachingSlaBreaches,
  sweepSlaBreachTriggers,
} from '@/lib/server/domains/sla/sla.service'
import {
  sweepApproachingTicketSlaBreaches,
  sweepTicketSlaBreachTriggers,
} from '@/lib/server/domains/sla/ticket-sla.sweep'

const log = logger.child({ component: 'workflow-sweep' })

/** A 'running' row older than this is presumed crashed rather than merely
 *  slow: every action in a run resolves in well under this window. */
const STALE_RUNNING_MS = 15 * 60 * 1000

/** Cap on rows handled per sweep pass, so a large backlog is worked down over
 *  successive ticks instead of one tick scanning everything. */
const SWEEP_BATCH_SIZE = 200

/** When a parked run's timer fires (or fired): the park moment — waitStartedAt,
 *  or started_at for a legacy cursor that never recorded one — plus the wait
 *  itself. Shared basis for both sweep passes. */
function waitFireTimeMs(run: Pick<WorkflowRun, 'startedAt'>, cursor: Partial<WaitCursor>): number {
  const parkedAtMs = cursor.waitStartedAt
    ? new Date(cursor.waitStartedAt).getTime()
    : run.startedAt.getTime()
  return parkedAtMs + (cursor.waitSeconds ?? 0) * 1000
}

/**
 * Settle every 'running' run that has sat past the stale threshold: a crash
 * between claiming the run and its first settle leaves it there, holding the
 * customer_facing exclusive lock forever. Settling to 'interrupted' releases
 * the lock so a fresh run can start on the conversation. Each settle is
 * guarded on state='running', so a run that finishes normally between the
 * select and this update is left alone (no double event, no clobbering a
 * legitimate outcome).
 *
 * Staleness is measured from the run's last known activity, not started_at
 * alone: started_at is set once at insert and never advances, so a run that
 * parked at a long wait and then resumed is briefly 'running' again with an
 * ancient started_at — legitimately mid-actions, not crashed. The activity
 * basis is the latest of started_at, the wait's scheduled fire time, and the
 * cursor's resumedAt (stamped by the claim itself, which covers a timer that
 * fired far later than scheduled). The started_at filter in SQL stays as a
 * cheap prefilter; the per-row basis check then skips runs whose latest
 * activity is recent. A legacy cursor without any of these falls back to
 * started_at alone. Returns how many were settled.
 */
export async function sweepStaleRunningRuns(now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - STALE_RUNNING_MS)
  const candidates = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.state, 'running'), lt(workflowRuns.startedAt, threshold)))
    .orderBy(asc(workflowRuns.startedAt))
    .limit(SWEEP_BATCH_SIZE)

  let swept = 0
  for (const run of candidates) {
    const cursor = readCursor(run)
    const resumedAtMs = cursor.resumedAt ? new Date(cursor.resumedAt).getTime() : 0
    const basis = Math.max(run.startedAt.getTime(), waitFireTimeMs(run, cursor), resumedAtMs)
    if (now.getTime() - basis <= STALE_RUNNING_MS) continue // active recently, still live

    const settled = await settleRunning(run.id, { state: 'interrupted', endedAt: now })
    if (!settled) continue // already moved on between the select and this update
    await logRunEvent(run.id, run.workflowId, run.subjectPrincipalId, 'swept_stale')
    swept++
  }
  return swept
}

/**
 * Reschedule every overdue 'waiting' run whose durable timer has gone missing.
 * Only runs whose wait has already elapsed are examined: a healthy parked run
 * needs no attention before its fire time, and checking every parked run's job
 * each tick would both waste a queue lookup per run per tick and let a large
 * parked population starve real orphans out of the batch cap. An orphan whose
 * wait is not yet due is simply caught on the first tick after it becomes due,
 * so a resume is late by at most one sweep interval.
 *
 * For each due run, the BullMQ job id the engine would have scheduled under is
 * reconstructed (workflowWaitJobId from the cursor's waitSeq; nullish for a
 * legacy run keys by run id alone) and looked up. A live job means the timer
 * just hasn't been processed yet — skip. A missing job gets a fresh timer for
 * whatever remains of the wait (zero for one already elapsed), and the cursor
 * is refreshed to what was actually scheduled so the next tick finds the new
 * job under its exact key — a legacy run converges to the sequence-keyed id
 * after one reschedule — and the fire-time basis reflects the reschedule
 * rather than the original park. Returns how many were rescheduled.
 */
export async function sweepOrphanedWaitingRuns(now: Date): Promise<number> {
  const due = sql`coalesce((${workflowRuns.cursor}->>'waitStartedAt')::timestamptz, ${workflowRuns.startedAt}) + make_interval(secs => coalesce((${workflowRuns.cursor}->>'waitSeconds')::numeric, 0)) <= ${now.toISOString()}::timestamptz`
  // A non-timer park (Phase C: an interactive block's 'input' wait, slice
  // C-1; a let_assistant_answer's 'assistant' wait, slice C-6) schedules NO
  // BullMQ timer — it resumes on an external signal (the customer's
  // structured reply, or assistant.handed_off / conversation close via
  // event-trigger.ts), not a clock. Its cursor's waitSeconds is always 0, so
  // the `due` expression above would otherwise mark it due immediately after
  // park and this pass would try to "reschedule" a timer for a wait that was
  // never supposed to have one. Checked as a positive "is this a timer wait"
  // filter (rather than excluding each non-timer kind by name) so a future
  // non-timer waitKind is excluded automatically instead of silently falling
  // through this filter until someone remembers to add it here too.
  const isTimerWait = sql`coalesce(${workflowRuns.cursor}->>'waitKind', 'timer') = 'timer'`
  const candidates = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.state, 'waiting'), due, isTimerWait))
    .orderBy(asc(workflowRuns.startedAt))
    .limit(SWEEP_BATCH_SIZE)

  let rescheduled = 0
  for (const run of candidates) {
    const cursor = readCursor(run)
    const job = await getWorkflowWaitJob(workflowWaitJobId(run.id, cursor.waitSeq))
    if (job) {
      const state = await job.getState()
      if (state !== 'failed' && state !== 'completed') continue
      // A failed/completed job is retained by removeOnFail/removeOnComplete
      // (7-day age), so it still occupies its jobId. BullMQ treats
      // queue.add() with an existing jobId as a no-op, so scheduleWorkflowResume
      // below (which reuses the same waitSeq-keyed jobId) would silently never
      // re-enqueue — leaving the run parked until the stale job ages out.
      // Remove it first to free the id for the fresh resume.
      await job.remove()
    }

    const remainingSeconds = Math.max(0, waitFireTimeMs(run, cursor) - now.getTime()) / 1000
    const waitSeq = cursor.waitSeq ?? 1
    await scheduleWorkflowResume(run.id, remainingSeconds, waitSeq)

    // Guarded refresh: the run may have been claimed or interrupted since the
    // select, and that state change must not be overwritten.
    const refreshed: WaitCursor = {
      resumeNodeId: cursor.resumeNodeId ?? null,
      waitSeconds: remainingSeconds,
      waitSeq,
      waitStartedAt: now.toISOString(),
    }
    await db
      .update(workflowRuns)
      .set({ cursor: refreshed as unknown as Record<string, unknown> })
      .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.state, 'waiting')))

    await logRunEvent(run.id, run.workflowId, run.subjectPrincipalId, 'swept_rescheduled')
    rescheduled++
  }
  return rescheduled
}

/** The bounded authority this sweep's own close acts with — just enough to
 *  pass setConversationStatus's canActAsAgent gate (CONVERSATION_REPLY) and
 *  perform the status change itself. Deliberately narrower than the run
 *  engine's own workflowActor (workflow.engine.ts): this pass only ever
 *  closes a conversation, never anything else. */
const SWEEP_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.CONVERSATION_SET_STATUS,
])

function sweepActor(): Actor {
  return boundedServiceActor(SWEEP_PERMISSIONS)
}

/** True when the conversation has at least one non-deleted VISITOR message —
 *  a customer who engaged, even if they later stopped answering the
 *  interactive block, is "never engaged" only in the sense of not answering
 *  this one prompt; the thread itself is live and stays open for a human.
 *  Only a conversation with zero visitor messages at all (the interactive
 *  block was the very first thing sent, e.g. a front-door triage bot, and
 *  nobody ever replied) counts as abandoned. */
async function hasVisitorMessage(conversationId: ConversationId): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.senderType, 'visitor'),
        isNull(conversationMessages.deletedAt)
      )
    )
    .limit(1)
  return Boolean(row)
}

/** True when the conversation's visitor has a real (non-synthetic) email on
 *  file, checked with the same precedence conversation replies route by
 *  (resolveReplyRecipient): an identified visitor's own account email wins;
 *  otherwise a contact email captured on the principal; otherwise the
 *  conversation's own captured `visitorEmail` (set by a pre-chat form or an
 *  email-collecting block). realEmail() is the final sanitization pass so
 *  an anonymous visitor's synthetic placeholder address never counts as
 *  "captured". */
async function hasCapturedEmail(conversationId: ConversationId): Promise<boolean> {
  const [row] = await db
    .select({
      visitorEmail: conversations.visitorEmail,
      principalType: principal.type,
      contactEmail: principal.contactEmail,
      userEmail: user.email,
    })
    .from(conversations)
    .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row) return false
  const email = resolveReplyRecipient(
    { type: row.principalType, email: row.userEmail },
    row.contactEmail,
    row.visitorEmail
  )
  return realEmail(email) !== null
}

/**
 * The close half of abandoned-journey auto-close, run once per expired input
 * wait after its run has already been settled (see sweepExpiredInputWaits).
 * Closes the conversation via the standard setConversationStatus seam, acting
 * as a bounded service actor, but only when NEITHER escape hatch applies:
 * a conversation with any visitor message is engaged (a human should still
 * see it), and — when `keepIfEmailCaptured` — a conversation with a captured
 * contact email is left open for follow-up. An already-closed conversation is
 * left alone (no redundant write, no duplicate 'Conversation ended' notice).
 */
async function closeIfAbandoned(
  conversationId: ConversationId,
  keepIfEmailCaptured: boolean
): Promise<void> {
  const [convo] = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!convo || convo.status === 'closed') return
  if (await hasVisitorMessage(conversationId)) return
  if (keepIfEmailCaptured && (await hasCapturedEmail(conversationId))) return
  await setConversationStatus(conversationId, 'closed', sweepActor())
}

/**
 * Abandoned-journey auto-close (support platform, abandoned-journey
 * auto-close spec): sweep every 'waiting' run parked at an interactive
 * block's input wait (workflow-wait-queue.ts's InputWaitCursor) whose stamped
 * `expiresAt` has passed. `expiresAt` is null unless the workspace enabled
 * the setting at park time (see workflow.engine.ts's applyPlanAndSettle), so
 * this pass naturally examines nothing when the feature is off — no separate
 * enabled-check needed here.
 *
 * Two steps per expired run, in this order:
 *
 *  1. Guarded settle to 'interrupted' (guarded on state='waiting', mirroring
 *     sweepStaleRunningRuns's guard on 'running' — the analogous race: a
 *     customer's reply or a teammate/close interrupt landing between the
 *     select and this update must win, so the guarded update simply no-ops
 *     for the loser instead of clobbering it). Logs 'swept_expired'.
 *  2. The close decision (closeIfAbandoned) — ONLY reached once the settle
 *     above actually took effect, and only after it committed.
 *
 * This ordering matters for loop-safety: closeIfAbandoned's close raises a
 * conversation.status_changed event (dispatched asynchronously off this
 * call, via the workflow-dispatch queue — see event-trigger.ts's module
 * doc), which on a close normally resumes a parked assistant-wait or
 * interrupts every other waiting run on the conversation. By the time that
 * event is actually processed, THIS run is already 'interrupted' (step 1
 * committed first, synchronously, before the close is even issued) — so
 * event-trigger.ts's findWaitingCustomerFacingRun finds nothing to resume or
 * re-interrupt on this run. No circularity: the just-expired run cannot be
 * "closed back into" by its own sweep.
 *
 * `keepIfEmailCaptured` is read once per sweep tick (not stamped per-run at
 * park time, unlike `enabled`/`waitMinutes` — see the engine's stamping doc)
 * so a workspace that flips it mid-flight has every run in this tick decided
 * by the current value, not whatever was configured when each one parked.
 */
export async function sweepExpiredInputWaits(now: Date): Promise<number> {
  const isExpiredInputWait = and(
    eq(workflowRuns.state, 'waiting'),
    sql`coalesce(${workflowRuns.cursor}->>'waitKind', 'timer') = 'input'`,
    sql`(${workflowRuns.cursor}->>'expiresAt') IS NOT NULL`,
    sql`(${workflowRuns.cursor}->>'expiresAt')::timestamptz <= ${now.toISOString()}::timestamptz`
  )
  const candidates = await db
    .select()
    .from(workflowRuns)
    .where(isExpiredInputWait)
    .orderBy(asc(workflowRuns.startedAt))
    .limit(SWEEP_BATCH_SIZE)
  if (candidates.length === 0) return 0

  const { keepIfEmailCaptured } = await getWorkflowAbandonedAutoCloseSettings()

  let swept = 0
  for (const run of candidates) {
    const [settled] = await db
      .update(workflowRuns)
      .set({ state: 'interrupted', endedAt: now })
      .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.state, 'waiting')))
      .returning()
    if (!settled) continue // raced by a resume/interrupt between the select and here
    await logRunEvent(run.id, run.workflowId, run.subjectPrincipalId, 'swept_expired')
    swept++

    if (run.conversationId) {
      await closeIfAbandoned(run.conversationId, keepIfEmailCaptured)
    }
  }
  return swept
}

// ---------------------------------------------------------------------------
// Timer-driven unresponsive triggers (support platform §4.6):
// conversation.customer_unresponsive / teammate_unresponsive. See
// dispatcher.ts's dispatchWorkflowTrigger `targetWorkflowId` for the dispatch
// half (single pre-selected workflow, not the generic fan-out) and this
// section's own comments for the per-workflow-threshold scan + dedupe design.
// ---------------------------------------------------------------------------

/** Live workflows subscribed to either unresponsive trigger, each scanned
 *  with ITS OWN `inactivityMinutes` (design A: per-workflow scan — see the
 *  module doc below for why, in contrast to the SLA pair's design). */
const UNRESPONSIVE_TRIGGER_TYPES = [
  'conversation.customer_unresponsive',
  'conversation.teammate_unresponsive',
] as const

/** A conversation's relevant silence must have JUST crossed the workflow's
 *  threshold — `threshold <= silence < threshold + slack` — rather than
 *  simply "silence >= threshold", which would otherwise re-fire the same
 *  event id every tick for the life of a long silence. The dedupe itself is
 *  the deterministic BullMQ jobId (see scanUnresponsiveForWorkflow), but that
 *  job's completed record is only retained for a bounded time
 *  (workflow-dispatch-queue.ts's `removeOnComplete: { age: 86400 }`, 24h) —
 *  far shorter than `inactivityMinutes`' 14-day ceiling. Narrowing the scan to
 *  the crossing tick itself means the jobId is only ever (re-)produced once
 *  near the real crossing moment, so it never has to survive a multi-day
 *  retention window for correctness. Set well above the 5-minute cron
 *  interval to tolerate a slow/delayed tick without missing the window
 *  entirely; a sweep outage longer than this DOES miss that one firing
 *  (documented trade-off, same "late by at most one interval" philosophy
 *  sweepOrphanedWaitingRuns already documents above) rather than firing late
 *  and possibly duplicating a since-purged job.
 */
const UNRESPONSIVE_WINDOW_SLACK_MINUTES = 15

const UNRESPONSIVE_BATCH_SIZE = 200

/** How many dispatch calls a sweep pass runs concurrently (mapWithConcurrency's
 *  `limit`). A backlog tick scanning hundreds of candidates at 10-50ms per
 *  dispatch would otherwise serialize into seconds; bounded fan-out keeps a
 *  tick fast without unbounded concurrency against the queue/DB. */
const SWEEP_DISPATCH_CONCURRENCY = 8

function readInactivityMinutes(workflow: Pick<Workflow, 'triggerSettings'>): number {
  return (
    parseInactivityMinutes(workflow.triggerSettings.inactivityMinutes) ?? DEFAULT_INACTIVITY_MINUTES
  )
}

/**
 * Scan for conversations whose relevant silence just crossed `workflow`'s own
 * `inactivityMinutes`, and dispatch one synthetic event per match.
 *
 * teammate_unresponsive candidates: the last customer-facing message was from
 * the visitor (`waitingSince` IS NOT NULL — see conversation.service.ts's
 * three write sites: set on a visitor message when previously null, cleared
 * on any agent/assistant reply), silence measured from that same column (the
 * OLDEST unanswered message in the streak, matching the "customer waiting"
 * semantics `conversation.waiting_minutes` already exposes — see
 * condition.context.ts).
 *
 * customer_unresponsive candidates: the last customer-facing message was from
 * a teammate OR the assistant (`waitingSince` IS NULL, `lastMessageAt` is
 * that reply's own timestamp — both columns are updated in the same
 * transaction as every visitor/agent/assistant message, but NOT by an
 * internal note, see addAgentNote's doc). The EXISTS guard excludes the
 * pathological case of a conversation with zero real messages ever (every
 * known creation path inserts a first message atomically, so this should
 * never actually trim anything — kept as a cheap defensive floor rather than
 * trusting that invariant blindly).
 *
 * Both exclude closed/snoozed conversations (fixed rule, not configurable) —
 * "silence" is a conversations-table concept (waitingSince/lastMessageAt),
 * scanned inline right here rather than through a separate domain, so the
 * exclusion is just another SQL predicate on this same query. Contrast the
 * SLA pair (sla.service.ts's sweepApproachingSlaBreaches/sweepSlaBreachTriggers,
 * scanned further below): that scan lives in the SLA domain and deliberately
 * does NOT exclude closed/snoozed — see scanAndClaimSlaClocks's doc there for
 * why. Two triggers, two different status rules, by design; not something to
 * reconcile by moving code between the two.
 *
 * Dedupe: the BullMQ job id workflow-dispatch-queue.ts keys off `event.id` is
 * built from (triggerType, workflowId, conversationId, the anchor's own ISO
 * timestamp) — "last-relevant-message id or silence-start timestamp" per the
 * design brief, using the latter since `waitingSince`/`lastMessageAt` already
 * pin an exact instant without an extra message-id lookup. That anchor is
 * stable for the entire life of one continuous silence period (it only moves
 * when a NEW message arrives, which flips which trigger type even applies),
 * so repeated ticks over the same still-silent conversation reuse the exact
 * same id and dedupe at the queue — combined with the crossing-window scan
 * above, this fires at most once per continuous silence period per
 * workflow+conversation.
 */
async function scanUnresponsiveForWorkflow(workflow: Workflow, now: Date): Promise<number> {
  const inactivityMinutes = readInactivityMinutes(workflow)
  const thresholdMs = inactivityMinutes * 60_000
  const windowMs = UNRESPONSIVE_WINDOW_SLACK_MINUTES * 60_000
  const earliestAnchor = new Date(now.getTime() - thresholdMs - windowMs)
  const latestAnchor = new Date(now.getTime() - thresholdMs)

  const isTeammateUnresponsive = workflow.triggerType === 'conversation.teammate_unresponsive'
  const anchorColumn = isTeammateUnresponsive
    ? conversations.waitingSince
    : conversations.lastMessageAt

  const rows = await db
    .select({
      id: conversations.id,
      anchor: anchorColumn,
      // Only for the dispatched payload's EventConversationRef (webhook
      // payload parity with every sibling conversation event) — status is
      // always outside ('closed', 'snoozed') per the filter below.
      status: conversations.status,
      channel: conversations.channel,
      priority: conversations.priority,
      assignedTeamId: conversations.assignedTeamId,
    })
    .from(conversations)
    .where(
      and(
        isTeammateUnresponsive
          ? isNotNull(conversations.waitingSince)
          : isNull(conversations.waitingSince),
        sql`${conversations.status} NOT IN ('closed', 'snoozed')`,
        gt(anchorColumn, earliestAnchor),
        lte(anchorColumn, latestAnchor),
        sql`EXISTS (
          SELECT 1 FROM conversation_messages cm
          WHERE cm.conversation_id = ${conversations.id} AND cm.deleted_at IS NULL
        )`
      )
    )
    .limit(UNRESPONSIVE_BATCH_SIZE)

  let fired = 0
  await mapWithConcurrency(rows, SWEEP_DISPATCH_CONCURRENCY, async (row) => {
    if (!row.anchor) return // defensive: the NOT NULL filter above already excludes this
    const sinceAt = row.anchor.toISOString()
    const silenceMinutes = Math.floor((now.getTime() - row.anchor.getTime()) / 60_000)
    const jobId = `timer:${workflow.triggerType}:${workflow.id}:${row.id}:${sinceAt}`
    const payload = {
      conversationId: row.id,
      conversation: {
        id: row.id,
        status: row.status,
        channel: row.channel,
        priority: row.priority,
        assignedTeamId: row.assignedTeamId,
      },
      workflowId: workflow.id,
      silenceMinutes,
      sinceAt,
    }
    try {
      if (isTeammateUnresponsive) {
        await dispatchConversationTeammateUnresponsive(jobId, payload)
      } else {
        await dispatchConversationCustomerUnresponsive(jobId, payload)
      }
      fired++
    } catch (err) {
      log.error(
        { err, workflowId: workflow.id, conversationId: row.id },
        'unresponsive-trigger dispatch failed; continuing the rest of the batch'
      )
    }
  })
  return fired
}

/** Scan every live customer_unresponsive/teammate_unresponsive workflow with
 *  its own threshold. Returns the total number of synthetic events fired. */
export async function sweepUnresponsiveConversations(now: Date): Promise<number> {
  const liveWorkflows = await db
    .select()
    .from(workflows)
    .where(
      and(
        inArray(workflows.triggerType, UNRESPONSIVE_TRIGGER_TYPES),
        eq(workflows.status, 'live'),
        isNull(workflows.deletedAt)
      )
    )

  let fired = 0
  for (const workflow of liveWorkflows) {
    fired += await scanUnresponsiveForWorkflow(workflow, now)
  }
  return fired
}

// ---------------------------------------------------------------------------
// Timer-driven SLA triggers (support platform §4.6): sla.approaching_breach /
// sla.breached. The actual scan + CAS-guarded fire-once claim lives in the
// SLA domain (sla.service.ts's sweepApproachingSlaBreaches /
// sweepSlaBreachTriggers) — this section only orchestrates: reads which live
// workflows care (so an idle workspace with none pays no extra scan), resolves
// the lead-time input those functions need, and dispatches a synthetic event
// per claimed candidate. See sla.service.ts's module doc, right above those
// two functions, for why this pair dispatches through the STANDARD
// multi-workflow fan-out (dispatchWorkflowTrigger) instead of the unresponsive
// pair's single-workflow dispatchWorkflowTrigger `targetWorkflowId` dispatch.
// ---------------------------------------------------------------------------

function readBreachLeadMinutes(workflow: Pick<Workflow, 'triggerSettings'>): number {
  return (
    parseBreachLeadMinutes(workflow.triggerSettings.breachLeadMinutes) ??
    DEFAULT_BREACH_LEAD_MINUTES
  )
}

/** The live workflows subscribed to `triggerType`, or `[]` when none — a
 *  cheap pre-check so an idle workspace (the overwhelming common case) skips
 *  the SLA domain's scan entirely instead of paying a query every 5 minutes
 *  for nothing. */
async function liveWorkflowsForTrigger(triggerType: string): Promise<Workflow[]> {
  return db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.triggerType, triggerType),
        eq(workflows.status, 'live'),
        isNull(workflows.deletedAt)
      )
    )
}

/**
 * Scan + dispatch both SLA timer triggers. `sla.approaching_breach` scans at
 * the WIDEST `breachLeadMinutes` configured across every live workflow of
 * that type (see sla.service.ts's module doc for why one scalar marker can't
 * fire each live workflow independently at ITS OWN lead); `sla.breached` has
 * no configurable lead, so it only needs a live-workflow existence check.
 * Each trigger scans TWO axes per tick, sharing the same live-workflow
 * pre-check and lead resolution: the conversation clocks (sla.service.ts) and
 * the ticket-anchored TTR clock (ticket-sla.service.ts). A claimed ticket
 * candidate dispatches the same synthetic event shape as a conversation one,
 * extended with the ticket identity (`ticketId` + `ticket` ref) and
 * conversationId/conversation pointing at the ticket's linked CUSTOMER
 * conversation — all workflow runs are conversation-context, so a ticket
 * clock's trigger rides the conversation the ticket is anchored to. The
 * ticket scans already skip back-office tickets entirely (no customer
 * conversation to run against; their marker is still claimed — see
 * ticket-sla.service.ts's resolveTicketTriggerTarget), so every candidate
 * reaching here dispatches. Returns the total number of synthetic events
 * fired.
 */
export async function sweepSlaTimerTriggers(now: Date): Promise<number> {
  let fired = 0

  const approachingWorkflows = await liveWorkflowsForTrigger('sla.approaching_breach')
  if (approachingWorkflows.length > 0) {
    const leadMinutes = Math.max(...approachingWorkflows.map(readBreachLeadMinutes))
    const candidates = await sweepApproachingSlaBreaches(leadMinutes, now)
    await mapWithConcurrency(candidates, SWEEP_DISPATCH_CONCURRENCY, async (c) => {
      const jobId = `timer:sla.approaching_breach:${c.conversationId}:${c.clock}:${c.dueAt}`
      try {
        await dispatchSlaApproachingBreach(jobId, {
          conversationId: c.conversationId,
          conversation: c.conversation,
          clock: c.clock,
          dueAt: c.dueAt,
        })
        fired++
      } catch (err) {
        log.error(
          { err, conversationId: c.conversationId, clock: c.clock },
          'sla.approaching_breach dispatch failed; continuing the rest of the batch'
        )
      }
    })

    // Ticket-anchored TTR pass — same lead window, same trigger type; the
    // jobId keys on the TICKET id (not the conversation's) so a ticket-clock
    // dispatch never collides with a conversation-clock one in the queue's
    // dedupe window.
    const ticketCandidates = await sweepApproachingTicketSlaBreaches(leadMinutes, now)
    await mapWithConcurrency(ticketCandidates, SWEEP_DISPATCH_CONCURRENCY, async (c) => {
      const jobId = `timer:sla.approaching_breach:ticket:${c.ticketId}:${c.clock}:${c.dueAt}`
      try {
        await dispatchSlaApproachingBreach(jobId, {
          conversationId: c.conversationId,
          conversation: c.conversation,
          clock: c.clock,
          dueAt: c.dueAt,
          ticketId: c.ticketId,
          ticket: c.ticket,
        })
        fired++
      } catch (err) {
        log.error(
          { err, ticketId: c.ticketId, clock: c.clock },
          'sla.approaching_breach ticket dispatch failed; continuing the rest of the batch'
        )
      }
    })
  }

  const breachedWorkflows = await liveWorkflowsForTrigger('sla.breached')
  if (breachedWorkflows.length > 0) {
    const candidates = await sweepSlaBreachTriggers(now)
    await mapWithConcurrency(candidates, SWEEP_DISPATCH_CONCURRENCY, async (c) => {
      const jobId = `timer:sla.breached:${c.conversationId}:${c.clock}:${c.dueAt}`
      try {
        await dispatchSlaBreached(jobId, {
          conversationId: c.conversationId,
          conversation: c.conversation,
          clock: c.clock,
          dueAt: c.dueAt,
        })
        fired++
      } catch (err) {
        log.error(
          { err, conversationId: c.conversationId, clock: c.clock },
          'sla.breached dispatch failed; continuing the rest of the batch'
        )
      }
    })

    // Ticket-anchored TTR pass — see the approaching_breach ticket pass above.
    const ticketCandidates = await sweepTicketSlaBreachTriggers(now)
    await mapWithConcurrency(ticketCandidates, SWEEP_DISPATCH_CONCURRENCY, async (c) => {
      const jobId = `timer:sla.breached:ticket:${c.ticketId}:${c.clock}:${c.dueAt}`
      try {
        await dispatchSlaBreached(jobId, {
          conversationId: c.conversationId,
          conversation: c.conversation,
          clock: c.clock,
          dueAt: c.dueAt,
          ticketId: c.ticketId,
          ticket: c.ticket,
        })
        fired++
      } catch (err) {
        log.error(
          { err, ticketId: c.ticketId, clock: c.clock },
          'sla.breached ticket dispatch failed; continuing the rest of the batch'
        )
      }
    })
  }

  return fired
}

/**
 * Entry point for the sweep queue's repeating tick: run every pass and log
 * their counts. Any pass failing is a legitimate error (unlike the per-run
 * guards inside them, which are expected races, not failures) and propagates
 * rather than being swallowed here.
 */
export async function sweepWorkflowRuns(): Promise<void> {
  const now = new Date()
  const staleCount = await sweepStaleRunningRuns(now)
  const rescheduledCount = await sweepOrphanedWaitingRuns(now)
  const expiredCount = await sweepExpiredInputWaits(now)
  const unresponsiveCount = await sweepUnresponsiveConversations(now)
  const slaTimerCount = await sweepSlaTimerTriggers(now)
  if (
    staleCount > 0 ||
    rescheduledCount > 0 ||
    expiredCount > 0 ||
    unresponsiveCount > 0 ||
    slaTimerCount > 0
  ) {
    log.info(
      { staleCount, rescheduledCount, expiredCount, unresponsiveCount, slaTimerCount },
      'workflow-sweep run complete'
    )
  }
}
