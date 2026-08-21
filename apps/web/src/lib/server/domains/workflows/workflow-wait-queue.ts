/**
 * Durable workflow waits (support platform §4.6, Slice 5e). A 'wait' node parks
 * a run; this is the delayed job that resumes it when the timer fires.
 *
 * On the Postgres queue a delayed job is just a row whose `run_at` is the
 * wait's fire time, so a parked run costs one row rather than a live timer, and
 * a process restart cannot lose it. The dedupe key is the run id plus a per-run
 * wait sequence number, so re-scheduling the same wait (after a retry, or by
 * the sweeper) is a no-op while a later wait in the same run gets its own row.
 * The handler re-loads the run and calls `resumeWorkflowRun`, which itself
 * no-ops if a reply or close interrupted the run in the meantime.
 */
import {
  cancelJob,
  enqueueJob,
  findJobByDedupeKey,
  type ClaimedJob,
} from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import type { WorkflowRun, WorkflowBlockKind } from '@/lib/server/db'
// Statically imported, not deferred: a call-time import inside the tier would
// execute this module's graph under whichever workspace reached it first. The
// engine imports back into this module, so the two form a cycle — safe because
// neither touches the other at module top level, only inside a function.
import { resumeWorkflowRun } from './workflow.engine'

const log = logger.child({ component: 'workflow-wait-queue' })

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const WORKFLOW_WAIT_QUEUE = 'workflow-wait'

/** The three kinds of wait a run can park at — a plain timer, an interactive
 *  block awaiting a structured reply (input), or a `let_assistant_answer` park
 *  (assistant). Exported so call sites that need to name a kind (e.g.
 *  interruptWaitingRuns's excludeWaitKind) stay future-proof against a new
 *  kind being added here, instead of hand-rolling their own narrower literal
 *  union that would silently fail to accept it. */
export type WaitKind = 'timer' | 'input' | 'assistant'

/** The run cursor's shape while parked at a wait: the node to resume from, how
 *  long it waited, a monotonic per-run sequence number that gives each wait in
 *  a run its own durable-timer job id, and when it parked. Owned here alongside
 *  the job-id keying it drives; the engine writes it, the sweeper reads it.
 *
 * `waitKind` distinguishes a plain timed wait ('timer', the default — omitted
 * on a cursor written before this field existed, which reads the same way)
 * from an interactive block park ('input', see InputWaitCursor below) and a
 * `let_assistant_answer` park ('assistant', Phase C slice C-6 — no extra
 * fields beyond the base shape, unlike 'input': there's no block message or
 * allow-typing flag to stamp, just the node to resume at); typed as the full
 * union here (rather than just 'timer') purely so `Partial<InputWaitCursor>`
 * stays assignable wherever code still reads through the base `WaitCursor`
 * shape — every cursor-consuming call site keys off this field before
 * touching the fields that differ between the kinds. */
export interface WaitCursor {
  waitKind?: WaitKind
  resumeNodeId: string | null
  waitSeconds: number
  waitSeq: number
  waitStartedAt: string
  /** When the wait worker claimed the run back to running — merged in at claim
   *  time, not written at park time. The sweeper prefers it over the wait's
   *  scheduled fire time, which under-reports liveness when a timer fires late. */
  resumedAt?: string
}

/**
 * The cursor shape while parked at an interactive conversational block
 * (Phase C, slice C-1) — a customer's structured reply resumes the run, not a
 * timer, so NO BullMQ job is scheduled for one of these (see
 * scheduleWorkflowResume's call sites in workflow.engine.ts and the sweeper's
 * orphan pass, which must exclude waitKind:'input' rows from its due-filter
 * for the same reason: there is no timer to have gone missing).
 * `resumeNodeId` here is the interactive node's OWN id (walkWorkflow resumes
 * AT it, not at a successor — see graph.ts's module doc), unlike a timer
 * wait's resumeNodeId. `waitSeconds`/`waitSeq`/`waitStartedAt` are still
 * written (0 for waitSeconds) so every existing cursor reader that treats
 * WaitCursor as a defensive bag keeps working unchanged. Built via
 * Omit-and-override rather than `extends WaitCursor` — an interface can't
 * narrow an inherited property's type (waitKind 'timer'|'input' -> 'input'),
 * only an intersection type can.
 */
export type InputWaitCursor = Omit<WaitCursor, 'waitKind' | 'resumeNodeId'> & {
  waitKind: 'input'
  resumeNodeId: string
  /** The block message this cursor is waiting on a reply to — the
   *  correlation key event-trigger.ts matches a visitor's blockReply against. */
  blockMessageId: string
  blockKind: WorkflowBlockKind
  /** Baked in at park time so the hot resume path never re-reads the graph. */
  allowTypingInterrupt: boolean
  /** Reserved for the abandoned-journey auto-close (rides the existing
   *  sweeper); written but unconsumed until that ships. */
  expiresAt: string | null
}

/** The superset every readCursor caller reads through: every WaitCursor field
 *  (with `waitKind`'s FULL 'timer'|'input'|'assistant' union, unlike
 *  `Partial<InputWaitCursor>` alone, which narrows it to just 'input') plus
 *  InputWaitCursor's extra input-only fields, still optional. Built via
 *  `Omit<..., keyof WaitCursor>` rather than spelling those four fields out by
 *  hand, so a future field added to InputWaitCursor is picked up here too
 *  without a second edit. */
export type AnyWaitCursor = Partial<WaitCursor> & Partial<Omit<InputWaitCursor, keyof WaitCursor>>

/** Read a run's cursor defensively — the stored jsonb may be the empty default
 *  or an older shape (a run parked before the wait-sequence keying change
 *  carries neither waitSeq nor waitStartedAt; one parked before input waits
 *  existed carries none of InputWaitCursor's extra fields either). Check
 *  `waitKind` before trusting the input-only fields. */
export function readCursor(run: Pick<WorkflowRun, 'cursor'>): AnyWaitCursor {
  return (run.cursor ?? {}) as AnyWaitCursor
}

/** The dedupe key for a given run's Nth wait; exported so the run cursor's
 *  waitSeq is enough to reconstruct the key a scheduled job was written under
 *  (the sweeper reconciles stuck runs against the queue this way). A nullish
 *  waitSeq yields the key keyed by run id alone, for runs parked before waits
 *  were sequence-keyed. */
export function workflowWaitJobId(runId: string, waitSeq: number | null | undefined): string {
  return waitSeq == null ? `workflow-wait:${runId}` : `workflow-wait:${runId}:${waitSeq}`
}

/**
 * Schedule a run to resume after `waitSeconds`. `waitSeq` is the run's per-wait
 * sequence number (from its cursor), so each wait in a run gets a distinct
 * dedupe key instead of colliding with an earlier one. A zero/negative wait
 * resumes on the next pass.
 */
export async function scheduleWorkflowResume(
  runId: string,
  waitSeconds: number,
  waitSeq: number
): Promise<void> {
  const delayMs = Math.max(0, waitSeconds) * 1000
  await enqueueJob({
    queue: WORKFLOW_WAIT_QUEUE,
    payload: { runId, waitSeq },
    dedupeKey: workflowWaitJobId(runId, waitSeq),
    runAt: new Date(Date.now() + delayMs),
    maxAttempts: 3,
  })
}

/** What the sweeper needs to know about a scheduled wait: does it still exist,
 *  and is it still going to fire? Exported narrowly (rather than the queue
 *  itself) to keep queue internals out of the sweep module. */
export interface WorkflowWaitJobState {
  status: string
  /** True once the job can no longer fire on its own. */
  terminal: boolean
}

/** Look up a scheduled wait by its dedupe key. */
export async function getWorkflowWaitJob(dedupeKey: string): Promise<WorkflowWaitJobState | null> {
  const found = await findJobByDedupeKey(WORKFLOW_WAIT_QUEUE, dedupeKey)
  if (!found) return null
  return {
    status: found.status,
    terminal: found.status === 'succeeded' || found.status === 'failed',
  }
}

/** Free a dedupe key held by a terminal wait job, so a fresh one can be written. */
export async function removeWorkflowWaitJob(dedupeKey: string): Promise<void> {
  await cancelJob(WORKFLOW_WAIT_QUEUE, dedupeKey)
}

/** Resume one parked run. */
export async function runWorkflowWait(job: ClaimedJob): Promise<void> {
  const { runId, waitSeq } = job.payload as { runId?: string; waitSeq?: number }
  if (!runId) {
    log.error({ jobId: job.jobId }, 'workflow-wait job carried no run id')
    return
  }
  await resumeWorkflowRun(runId as Parameters<typeof resumeWorkflowRun>[0], {
    expectedWaitSeq: waitSeq as number,
  })
}
