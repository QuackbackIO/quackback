/**
 * Job-owned outbox drain. Same fan-out as `relay.ts`, but the work is a
 * `job_queue` row written in the same transaction as `emit()`.
 *
 * The handler loads the authoritative event by id, skips already-published
 * and relay-owned rows, then resolves destinations and enqueues hook jobs
 * with the same deterministic keys the relay uses. Destination failure
 * throws so the job retries; it cannot roll back the domain mutation
 * (that transaction already committed).
 */
import { db, events, eq } from '@/lib/server/db'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { enqueueHookJobsWithIds } from './process'
import { hydrateEvent, MAX_DEPTH, MAX_STRICT_RESOLVE_ATTEMPTS } from './relay'
import { resolveTargets } from './resolvers/registry'
import { toLegacyEvent } from './to-legacy-event'
import crypto from 'crypto'
import type { HookTarget } from './hook-types'

const log = logger.child({ component: 'event-dispatch' })

export const EVENT_DISPATCH_QUEUE = 'event-dispatch'

function targetKey(target: HookTarget): string {
  return crypto
    .createHash('sha256')
    .update(target.deliveryKey ?? JSON.stringify(target.target ?? null))
    .digest('hex')
    .slice(0, 24)
}

export async function runEventDispatch(job: ClaimedJob): Promise<void> {
  const eventId = typeof job.payload.eventId === 'string' ? job.payload.eventId : null
  if (!eventId) {
    log.error(
      { job_id: job.jobId },
      'event-dispatch payload has no eventId — treating as published no-op'
    )
    return
  }

  const [row] = await db.select().from(events).where(eq(events.eventId, eventId)).limit(1)
  if (!row) {
    log.warn({ event_id: eventId }, 'event-dispatch: event row gone — no-op')
    return
  }
  if (row.publishedAt) return
  if (row.dispatchOwner !== 'job') {
    log.info(
      { event_id: eventId, owner: row.dispatchOwner },
      'event-dispatch skipped relay-owned row'
    )
    return
  }

  const event = hydrateEvent(row)
  if (event.context.depth > MAX_DEPTH) {
    log.error(
      {
        event_id: event.eventId,
        type: event.type,
        depth: event.context.depth,
        causation: event.context.causationId,
      },
      'reaction-loop depth ceiling hit — event marked published without fan-out'
    )
    await db.update(events).set({ publishedAt: new Date() }).where(eq(events.id, row.id))
    return
  }

  const degraded = job.attempts >= MAX_STRICT_RESOLVE_ATTEMPTS
  const targets = await resolveTargets(event, degraded ? { bestEffort: true } : undefined)

  await db.transaction(async (tx) => {
    if (targets.length > 0) {
      const legacy = toLegacyEvent(event)
      const jobs = targets.map((t) => ({
        name: `${event.type}:${t.type}`,
        data: { hookType: t.type, event: legacy, target: t.target, config: t.config },
        jobId: `${event.eventId}:${t.type}:${targetKey(t)}`,
      }))
      await enqueueHookJobsWithIds(jobs, { executor: tx })
    }
    await tx.update(events).set({ publishedAt: new Date() }).where(eq(events.id, row.id))
  })

  if (degraded) {
    log.error(
      { event_id: event.eventId, type: event.type, attempts: job.attempts },
      'event published via best-effort resolution after strict retries exhausted — a failing sink was skipped'
    )
  }
}
