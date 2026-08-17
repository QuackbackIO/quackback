/**
 * Event processing — the producer side of the `events` queue.
 *
 * Hooks are delivered by the Postgres job queue (`jobs/`), whose handler lives
 * in `hook-job.ts`. This module writes the event to the durable outbox and
 * offers the two enqueue shapes the rest of the system needs: the relay's bulk,
 * deterministically-keyed enqueue, and the scheduler's cancelable delayed one.
 *
 * A failed delivery is not lost: the job row keeps its `last_error` and its
 * attempt count, and terminal rows are retained per queue (30 days for a failed
 * `events` job) so *"did this webhook actually fire?"* stays answerable —
 * `SELECT … FROM job_queue WHERE queue = 'events'` in place of what used to be
 * a Redis failed-set inspection.
 */

import { cancelJob, enqueueJob, enqueueJobs } from '@/lib/server/jobs/job-queue'
import { HOOK_RETRY_ATTEMPTS } from './retry-schedule'
import type { HookJobData } from './hook-job'
import type { EventData } from './types'
import type { ConversationId, TicketId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'event-process' })

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const EVENTS_QUEUE = 'events'

export type { HookJobData }

/**
 * Process an event by resolving targets and enqueuing hooks.
 * Target resolution is awaited (~10-50ms). Hook execution runs in the background.
 */
export async function processEvent(event: EventData): Promise<void> {
  // EVENTING-V2 cutover: workflow triggers now ride the outbox → relay →
  // 'workflow' hook (workflowTriggerResolver), so the legacy fire-and-forget
  // enqueue-into-the-workflow-queue branch that used to live here is gone. The
  // outbox makes the trigger durable up to the workflow engine's own dispatch
  // queue — closing the crash window the old branch could drop a trigger in.

  // Settle SLA breach clocks off the same event (first-response / time-to-close).
  // Same fire-and-forget + lazy-import isolation as the workflow dispatch.
  void import('@/lib/server/domains/sla/sla.event-hooks')
    .then((m) => m.recordSlaFromEvent(event))
    .catch((err) => log.error({ err, event_type: event.type }, 'SLA hook failed to load'))

  // Convergence Phase 1a: a visitor message on a conversation paired with a
  // customer ticket reopens that ticket (dealbreaker 3 — a Messenger reply
  // must not leave the ticket stuck in "Waiting on customer"). Same
  // fire-and-forget + lazy-import isolation as the SLA hook above.
  void import('@/lib/server/domains/tickets/ticket.event-hooks')
    .then((m) => m.autoReopenPairTicketFromEvent(event))
    .catch((err) => log.error({ err, event_type: event.type }, 'ticket event hook failed to load'))

  // Confirm the assistant's resolution off a positive first CSAT rating. The
  // event only fires on the first submission, so the confirm runs at most once
  // per survey. Same fire-and-forget + lazy-import isolation as above.
  if (event.type === 'conversation.csat_submitted') {
    void import('@/lib/server/domains/assistant/assistant.involvement')
      .then((m) =>
        m.confirmResolutionFromCsat(event.data.conversation.id as ConversationId, event.data.rating)
      )
      .catch((err) =>
        log.error({ err, event_type: event.type }, 'assistant CSAT hook failed to load')
      )
  }

  // Summarize the conversation for future Quinn grounding (P2-A.4) once it
  // closes. A distinct branch from the generic SLA/CSAT hooks above — never
  // routed through the workflow engine's SUMMARY_EVENT_TYPES/'summary' target,
  // since this always runs on close, not per-workspace configuration. Same
  // fire-and-forget + lazy-import isolation; the service itself is also
  // best-effort (see conversation-summary.service.ts), so this never throws.
  if (event.type === 'conversation.status_changed' && event.data.newStatus === 'closed') {
    void import('@/lib/server/domains/assistant/conversation-summary.service')
      .then((m) => m.summarizeConversationOnClose(event.data.conversation.id as ConversationId))
      .catch((err) =>
        log.error({ err, event_type: event.type }, 'conversation summary hook failed to load')
      )
  }

  // Ticket sibling of the conversation-close summary above (Quinn Phase 4:
  // ticket grounding). Same fire-and-forget + lazy-import isolation; the
  // service is itself best-effort (see ticket-summary.service.ts), so this
  // never throws. Ticket status is a three-value category ('open' | 'pending'
  // | 'closed'); 'closed' is the resolution moment worth summarizing.
  if (event.type === 'ticket.status_changed' && event.data.newStatus === 'closed') {
    void import('@/lib/server/domains/assistant/ticket-summary.service')
      .then((m) => m.summarizeTicketOnClose(event.data.ticket.id as TicketId))
      .catch((err) =>
        log.error({ err, event_type: event.type }, 'ticket summary hook failed to load')
      )
  }

  // EVENTING-V2 (WO-18 cutover): the durable outbox is the ONLY path. The event
  // is written transactionally (closing the commit-vs-enqueue loss window) and
  // `event-dispatch` resolves targets and enqueues onto the `events` queue.
  // The legacy direct getHookTargets + bulk-add path is deleted.
  const { writeEventToOutbox } = await import('./outbox-dispatch')
  await writeEventToOutbox(event)
}

/**
 * Enqueue pre-resolved hook jobs with caller-supplied deterministic keys.
 * `event-dispatch` passes `jobId = ${eventId}:${sink}:${targetKey}` so a
 * retried dispatch re-enqueues the SAME key, which the unique index on
 * `(queue, dedupe_key)` turns into a no-op (and `hook_deliveries` catches
 * the rest) — the load-bearing mechanism for effectively-once delivery.
 * One statement, whatever the fan-out.
 */
export async function enqueueHookJobsWithIds(
  jobs: Array<{ name: string; data: HookJobData; jobId: string }>,
  opts?: { executor?: import('@/lib/server/jobs/job-queue').JobSqlExecutor }
): Promise<void> {
  if (jobs.length === 0) return
  await enqueueJobs(
    jobs.map(({ data, jobId }) => ({
      queue: EVENTS_QUEUE,
      payload: data as unknown as Record<string, unknown>,
      dedupeKey: jobId,
      maxAttempts: HOOK_RETRY_ATTEMPTS,
    })),
    opts
  )
}

/**
 * Nothing to close: the queue is a table, and the tier that consumes it is
 * stopped by `stopJobTier()`. Kept so the shutdown path and any test cleanup
 * that still calls it keep compiling while the last Redis call sites go.
 */
export async function closeQueue(): Promise<void> {}

// ============================================================================
// Delayed Job Helpers
// ============================================================================

/**
 * Schedule a job to run later.
 *
 * A delayed job is a row whose `run_at` is in the future, so it survives a
 * restart by construction — the reference kept it in Redis, where a flush lost
 * it. Used for scheduled changelog publishing and the status-page maintenance
 * window boundaries.
 */
export async function addDelayedJob(
  name: string,
  data: HookJobData,
  opts?: { delay?: number; jobId?: string }
): Promise<void> {
  const delay = Math.max(0, opts?.delay ?? 0)
  await enqueueJob({
    queue: EVENTS_QUEUE,
    payload: { ...data, jobName: name } as unknown as Record<string, unknown>,
    dedupeKey: opts?.jobId ?? null,
    runAt: new Date(Date.now() + delay),
    maxAttempts: HOOK_RETRY_ATTEMPTS,
  })
}

/**
 * Remove a delayed job by its key. Silent when the job does not exist (already
 * executed, or never created); a job that is *running* is deliberately not
 * removable — its lease is what adjudicates its result.
 */
export async function removeDelayedJob(jobId: string): Promise<void> {
  const removed = await cancelJob(EVENTS_QUEUE, jobId)
  if (removed > 0) log.debug({ job_id: jobId, removed }, 'removed delayed job')
}
