/**
 * Event reactions: side effects a domain event gets from durable jobs, off the
 * hook queue and apart from outbound delivery.
 *
 * `emit()` queues one job per reaction queue the event's type needs, in the
 * event's transaction, so the jobs commit with the event on both production
 * paths (native `emit()` producers and the legacy `dispatch*()` bridge).
 * Nothing gates them on the event-dispatch drain: a failing target resolver,
 * a slow retry or a worker crash after the event is published cannot delay or
 * lose a reaction.
 *
 * Two queues, split by what the reactions need:
 *
 * - `event-reactions` holds the reactions that read state an earlier event
 *   left (the SLA recorders above all: a visitor message re-arms the clock the
 *   agent's reply settles). It runs one job at a time per worker process in
 *   enqueue order, so in the common case they apply in event order. That is
 *   not a global order: a retry runs behind later jobs, two worker processes
 *   each run one, a crashed job re-runs once its lease lapses, and a queue
 *   drained after a rollback runs old jobs late. So these reactions read the
 *   database rather than rely on the order: the response clocks read the
 *   conversation's messages (`domains/sla/sla.messages.ts`), a pause or resume
 *   checks the entity's current status, and the pair-ticket reopen leaves a
 *   later status move standing. That narrows what a late or retried reaction
 *   can do without removing it; JOBS.md §10 lists what can still differ from
 *   an in-order run. Its handler is `event-reactions-queue.ts`.
 * - `event-summaries` holds the close summaries: slow AI calls that do not
 *   depend on order, kept off the serial queue so a slow provider cannot hold
 *   up an SLA clock. Its handler is `event-summaries-queue.ts`.
 *
 * This module is the table `emit()` reads, kept free of the reactions' own
 * imports, plus the job runner both handlers share.
 */
import { db, events, eq } from '@/lib/server/db'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { hydrateEvent } from './outbox'
import { toLegacyEvent } from './to-legacy-event'
import type { EventData } from './types'

const log = logger.child({ component: 'event-reactions' })

export const EVENT_REACTIONS_QUEUE = 'event-reactions'
export const EVENT_SUMMARIES_QUEUE = 'event-summaries'

/** Each queue's reactions, and the event types each reaction handles. */
export const EVENT_REACTIONS = {
  [EVENT_REACTIONS_QUEUE]: {
    // Settle, pause and resume SLA breach clocks (conversation and ticket).
    sla: ['message.created', 'conversation.status_changed', 'ticket.status_changed'],
    // A visitor message on a conversation paired with a customer ticket
    // reopens that ticket.
    'pair-ticket-reopen': ['message.created'],
    // Confirm the assistant's resolution off a positive first CSAT rating.
    'assistant-csat-confirm': ['conversation.csat_submitted'],
  },
  [EVENT_SUMMARIES_QUEUE]: {
    // Summarize a closed conversation for future assistant grounding.
    'conversation-summary': ['conversation.status_changed'],
    // Summarize a closed ticket for future assistant grounding.
    'ticket-summary': ['ticket.status_changed'],
  },
} as const satisfies Record<string, Record<string, readonly EventData['type'][]>>

export type ReactionQueue = keyof typeof EVENT_REACTIONS
export type ReactionName<Q extends ReactionQueue> = keyof (typeof EVENT_REACTIONS)[Q] & string
/**
 * One reaction. `signal` aborts at the job's deadline; a reaction that can
 * cancel its work (an AI call) passes it on.
 */
export type ReactionRun = (event: EventData, signal: AbortSignal) => Promise<void> | undefined

/**
 * How long one event's reactions on each queue may run before the job fails.
 * A reaction blocked on a row lock or a stalled provider would otherwise hold
 * its job, and on `event-reactions` the one lane, until the process restarts.
 * At the deadline the job fails, which frees the lane, and retries or is
 * dropped per the queue's `maxAttempts`. The summaries wait on an AI provider,
 * so they get longer.
 */
export const REACTION_DEADLINE_MS: Record<ReactionQueue, number> = {
  [EVENT_REACTIONS_QUEUE]: 30_000,
  [EVENT_SUMMARIES_QUEUE]: 120_000,
}

const QUEUES = Object.keys(EVENT_REACTIONS) as ReactionQueue[]

/** The reactions on `queue` that handle an event of `type`. */
function reactionsFor<Q extends ReactionQueue>(queue: Q, type: string): ReactionName<Q>[] {
  const table = EVENT_REACTIONS[queue] as Record<ReactionName<Q>, readonly string[]>
  return (Object.keys(table) as ReactionName<Q>[]).filter((name) => table[name].includes(type))
}

/** The reaction queues `emit()` must queue a job on for an event of this type. */
export function reactionQueuesFor(type: string): ReactionQueue[] {
  return QUEUES.filter((queue) => reactionsFor(queue, type).length > 0)
}

/**
 * Run one reaction job: every reaction on its queue that handles the event,
 * waiting for all of them so one failure never starves the others. A reaction
 * that throws then fails the job, which retries the event's reactions on that
 * queue: they are idempotent against a repeat of the same event. The SLA
 * reaction throws on purpose, so a transient fault in a recorder is retried
 * rather than lost. The pair-ticket reopen, the CSAT confirm and the summaries
 * are best-effort: they log and swallow their own errors, so only the events
 * read and the deadline below fail their jobs.
 *
 * The reactions share a deadline (REACTION_DEADLINE_MS). Past it the job fails
 * and its signal aborts. A reaction that cannot be cancelled (a database call)
 * keeps running in the background, and a retry can overlap it, which the
 * reactions tolerate: their writes are guarded on the state they read.
 */
export async function runReactionJob<Q extends ReactionQueue>(
  queue: Q,
  job: ClaimedJob,
  runs: Record<ReactionName<Q>, ReactionRun>
): Promise<void> {
  const eventId = typeof job.payload.eventId === 'string' ? job.payload.eventId : null
  if (!eventId) {
    log.error({ job_id: job.jobId, queue }, 'reaction job payload has no eventId, skipping')
    return
  }

  const [row] = await db.select().from(events).where(eq(events.eventId, eventId)).limit(1)
  if (!row) {
    log.warn({ event_id: eventId, queue }, 'reaction job: event row gone, skipping')
    return
  }

  const event = toLegacyEvent(hydrateEvent(row))
  const matching = reactionsFor(queue, event.type)
  const deadlineMs = REACTION_DEADLINE_MS[queue]
  const controller = new AbortController()
  const running = new Set<string>(matching)
  const settled = Promise.allSettled(
    matching.map((name) =>
      Promise.resolve()
        .then(() => runs[name](event, controller.signal))
        .finally(() => running.delete(name))
    )
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), deadlineMs)
    timer.unref?.()
  })
  const results = await Promise.race([settled, deadline]).finally(() => clearTimeout(timer))
  if (results === 'deadline') {
    const stuck = [...running]
    const err = new Error(
      `event reactions passed their ${deadlineMs}ms deadline: ${stuck.join(', ')}`
    )
    controller.abort(err)
    log.error(
      {
        event_type: event.type,
        event_id: eventId,
        queue,
        reactions: stuck,
        deadline_ms: deadlineMs,
      },
      'event reactions passed their deadline, failing the job'
    )
    throw err
  }

  const failures = results.flatMap((result, i) =>
    result.status === 'rejected' ? [{ reaction: matching[i], err: result.reason }] : []
  )
  for (const { reaction, err } of failures) {
    log.error({ err, event_type: event.type, event_id: eventId, reaction }, 'event reaction failed')
  }
  if (failures.length > 0) throw failures[0].err
}
