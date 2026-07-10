/**
 * Durable workflow waits (support platform §4.6, Slice 5e). A 'wait' node parks a
 * run; this is the BullMQ delayed job that resumes it when the timer fires. The
 * job id is keyed by run id plus a per-run wait sequence number, so re-scheduling
 * the same wait (e.g. after a retry) dedupes rather than stacking, while a later
 * wait in the same run gets its own job instead of colliding with an earlier one
 * that is still active or retained. The worker re-loads the run and calls
 * resumeWorkflowRun, which itself no-ops if a reply/close interrupted the run in
 * the meantime.
 *
 * Registered in the worker registry so boot/drain manage it like every other
 * queue; it initializes lazily on the first scheduled wait.
 */
import { Queue, Worker, type Job } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'
import type { WorkflowRun, WorkflowBlockKind } from '@/lib/server/db'

const log = logger.child({ component: 'workflow-wait-queue' })

const QUEUE_NAME = '{workflow-wait}'
const CONCURRENCY = 4

interface WorkflowWaitJob {
  runId: string
}

let initPromise: Promise<{
  queue: Queue<WorkflowWaitJob>
  worker: Worker<WorkflowWaitJob> | null
}> | null = null

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<WorkflowWaitJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 100, age: 7 * 86400 },
      removeOnFail: { age: 7 * 86400 },
    },
  })

  // Consumer side is role-gated: web-role replicas enqueue and register
  // schedules but never construct a Worker (see queue/role.ts).
  const worker = shouldRunWorkers()
    ? new Worker<WorkflowWaitJob>(
        QUEUE_NAME,
        async (job) => {
          const { resumeWorkflowRun } = await import('./workflow.engine')
          await resumeWorkflowRun(job.data.runId as Parameters<typeof resumeWorkflowRun>[0])
        },
        { connection, concurrency: CONCURRENCY }
      )
    : null

  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout (5s)')), REDIS_READY_TIMEOUT_MS)
      ),
    ])
  } catch (error) {
    await queue.close().catch(() => {})
    await worker?.close().catch(() => {})
    throw error
  }

  worker?.on('failed', (job, error) => {
    if (!job) return
    const isPermanent =
      job.attemptsMade >= (job.opts.attempts ?? 1) || error.name === 'UnrecoverableError'
    log.error(
      { err: error, runId: job.data.runId, permanent: isPermanent },
      'workflow-wait resume failed'
    )
  })

  return { queue, worker }
}

async function ensureQueue() {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise
}

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

/** The BullMQ job id for a given run's Nth wait; exported so the run cursor's
 *  waitSeq is enough to reconstruct the id a scheduled job was keyed under
 *  (the sweeper reconciles stuck runs against the queue this way). A nullish
 *  waitSeq yields the id keyed by run id alone, for runs parked before waits
 *  were sequence-keyed. */
export function workflowWaitJobId(runId: string, waitSeq: number | null | undefined): string {
  return waitSeq == null ? `workflow-wait:${runId}` : `workflow-wait:${runId}:${waitSeq}`
}

/**
 * Schedule a run to resume after `waitSeconds`. `waitSeq` is the run's per-wait
 * sequence number (from its cursor), so each wait in a run gets a distinct job
 * id instead of dedupe-colliding with an earlier one. A zero/negative wait
 * resumes on the next tick.
 */
export async function scheduleWorkflowResume(
  runId: string,
  waitSeconds: number,
  waitSeq: number
): Promise<void> {
  const { queue } = await ensureQueue()
  await queue.add(
    'workflow-wait:resume',
    { runId },
    { jobId: workflowWaitJobId(runId, waitSeq), delay: Math.max(0, waitSeconds) * 1000 }
  )
}

/** Look up a scheduled wait job by id, for the sweeper to check whether a
 *  waiting run's durable timer is still live. Exported narrowly (rather than
 *  the queue itself) to keep BullMQ internals out of the sweep module. */
export async function getWorkflowWaitJob(jobId: string): Promise<Job<WorkflowWaitJob> | undefined> {
  const { queue } = await ensureQueue()
  return queue.getJob(jobId)
}

/** Eager init (called from startup via the worker registry). */
export async function initWorkflowWaitWorker(): Promise<void> {
  await ensureQueue()
  log.info('workflow-wait worker initialized')
}

export async function closeWorkflowWaitQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker?.close().catch(() => {})
  await queue.close().catch(() => {})
}
