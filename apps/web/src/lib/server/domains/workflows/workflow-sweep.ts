/**
 * Workflow run sweeper (support platform §4.6, durable-wait recovery). A run
 * is durable only at wait boundaries, which leaves two stranding modes with
 * no recovery path otherwise: a process crash mid-run leaves a row stuck in
 * state 'running' forever, holding the customer_facing exclusive lock on its
 * conversation; and if Redis was down when a wait was scheduled, or its job
 * was lost, a 'waiting' row has no timer and never resumes. This module scans
 * for both and reconciles them; workflow-sweep-queue runs it on a repeating
 * timer.
 */
import { db, and, eq, lt, asc, sql, workflowRuns, type WorkflowRun } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { settleRunning, logRunEvent } from './workflow.engine'
import {
  getWorkflowWaitJob,
  scheduleWorkflowResume,
  workflowWaitJobId,
  readCursor,
  type WaitCursor,
} from './workflow-wait-queue'

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
    if (job) continue // timer is live, just not processed yet

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

/**
 * Entry point for the sweep queue's repeating tick: run both passes and log
 * their counts. Either pass failing is a legitimate error (unlike the
 * per-run guards inside them, which are expected races, not failures) and
 * propagates rather than being swallowed here.
 */
export async function sweepWorkflowRuns(): Promise<void> {
  const now = new Date()
  const staleCount = await sweepStaleRunningRuns(now)
  const rescheduledCount = await sweepOrphanedWaitingRuns(now)
  if (staleCount > 0 || rescheduledCount > 0) {
    log.info({ staleCount, rescheduledCount }, 'workflow-sweep run complete')
  }
}
