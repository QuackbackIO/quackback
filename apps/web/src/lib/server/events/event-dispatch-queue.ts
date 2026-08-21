/**
 * Job-owned outbox drain. The work is a `job_queue` row written in the
 * same transaction as `emit()`.
 *
 * The handler loads the authoritative event by id, skips already-published
 * and leftover relay-owned rows, then resolves destinations and enqueues
 * hook jobs with deterministic keys. Destination failure throws so the
 * job retries; it cannot roll back the domain mutation (that transaction
 * already committed). After the last attempt a best-effort failure still
 * marks the event published so the spent dedupe key cannot pin it.
 */
import { db, events, eq, sql } from '@/lib/server/db'
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { SINGLE_TENANT_ID } from '@/lib/server/tenancy/after-commit'
import { getCurrentTenant } from '@/lib/server/tenancy/tenant-context'
import { enqueueHookJobsWithIds } from './process'
import { hydrateEvent, MAX_DEPTH, MAX_STRICT_RESOLVE_ATTEMPTS } from './outbox'
import { resolveTargets } from './resolvers/registry'
import { toLegacyEvent } from './to-legacy-event'
import crypto from 'crypto'
import type { HookTarget } from './hook-types'

const log = logger.child({ component: 'event-dispatch' })

export const EVENT_DISPATCH_QUEUE = 'event-dispatch'

/** One UPDATE+INSERT batch. A leftover outbox should be small. */
const RELAY_CONVERT_BATCH = 200
/** Ceiling so a huge leftover set cannot block a drain pass. */
const RELAY_CONVERT_MAX_BATCHES = 50

const convertedTenants = new Set<string>()

export function __resetRelayOwnedConvertForTests(): void {
  convertedTenants.clear()
}

/**
 * One-shot: leftover unpublished `dispatch_owner=relay` rows become job-owned
 * and get an `event-dispatch` job. Bounded, once per tenant per process
 * (a capped batch leaves the tenant unmarked so a later pass continues).
 */
export async function convertRelayOwnedEvents(opts?: {
  force?: boolean
}): Promise<{ converted: number; enqueued: number }> {
  const tenantId = getCurrentTenant()?.tenantId ?? SINGLE_TENANT_ID
  if (!opts?.force && convertedTenants.has(tenantId)) {
    return { converted: 0, enqueued: 0 }
  }

  const limit = RELAY_CONVERT_BATCH
  let converted = 0
  let enqueued = 0
  let hitCap = false

  try {
    for (let batch = 0; batch < RELAY_CONVERT_MAX_BATCHES; batch++) {
      const step = await convertRelayOwnedBatch(limit)
      converted += step.converted
      enqueued += step.enqueued
      if (step.converted < limit) break
      if (batch === RELAY_CONVERT_MAX_BATCHES - 1) hitCap = true
    }
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    if (code === '42P01' || code === '42703') {
      log.warn({ err }, 'relay-owned event convert skipped — schema not ready')
      return { converted, enqueued }
    }
    throw err
  }

  if (!hitCap) convertedTenants.add(tenantId)
  if (converted > 0) {
    log.info(
      { converted, enqueued, tenant: tenantId, capped: hitCap },
      'converted leftover relay-owned events onto the job path'
    )
  }
  return { converted, enqueued }
}

async function convertRelayOwnedBatch(
  limit: number
): Promise<{ converted: number; enqueued: number }> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      UPDATE events
      SET dispatch_owner = 'job'
      WHERE id IN (
        SELECT id FROM events
        WHERE published_at IS NULL AND dispatch_owner = 'relay'
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING event_id
    `)
    const ids = getExecuteRows<{ event_id: string }>(result).map((row) => row.event_id)
    let enqueued = 0
    for (const eventId of ids) {
      const inserted = await enqueueJob({
        queue: EVENT_DISPATCH_QUEUE,
        payload: { eventId },
        dedupeKey: `event-dispatch:${eventId}`,
        maxAttempts: 10,
        executor: tx,
      })
      if (inserted.inserted) enqueued += 1
    }
    return { converted: ids.length, enqueued }
  })
}

function targetKey(target: HookTarget): string {
  return crypto
    .createHash('sha256')
    .update(target.deliveryKey ?? JSON.stringify(target.target ?? null))
    .digest('hex')
    .slice(0, 24)
}

export interface EventDispatchDeps {
  resolve?: typeof resolveTargets
  enqueue?: typeof enqueueHookJobsWithIds
}

export async function runEventDispatch(
  job: ClaimedJob,
  deps: EventDispatchDeps = {}
): Promise<void> {
  const resolve = deps.resolve ?? resolveTargets
  const enqueue = deps.enqueue ?? enqueueHookJobsWithIds

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
      'event-dispatch skipped leftover relay-owned row'
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

  const lastAttempt = job.attempts >= job.maxAttempts
  const degraded = job.attempts >= MAX_STRICT_RESOLVE_ATTEMPTS || lastAttempt

  try {
    const targets = await resolve(event, degraded ? { bestEffort: true } : undefined)

    await db.transaction(async (tx) => {
      if (targets.length > 0) {
        const legacy = toLegacyEvent(event)
        const jobs = targets.map((t) => ({
          name: `${event.type}:${t.type}`,
          data: { hookType: t.type, event: legacy, target: t.target, config: t.config },
          jobId: `${event.eventId}:${t.type}:${targetKey(t)}`,
        }))
        await enqueue(jobs, { executor: tx })
      }
      await tx.update(events).set({ publishedAt: new Date() }).where(eq(events.id, row.id))
    })

    if (degraded) {
      log.error(
        { event_id: event.eventId, type: event.type, attempts: job.attempts },
        'event published via best-effort resolution after strict retries exhausted — a failing sink was skipped'
      )
    }
  } catch (err) {
    // A terminal failure must not leave the event unpublished under a spent
    // `event-dispatch:${eventId}` key. Same last-resort publish the relay used.
    if (lastAttempt) {
      await db.update(events).set({ publishedAt: new Date() }).where(eq(events.id, row.id))
      log.error(
        {
          err,
          event_id: event.eventId,
          type: event.type,
          attempts: job.attempts,
          max_attempts: job.maxAttempts,
        },
        'event published after dispatch exhausted all attempts — destinations were not fully fanned out'
      )
      return
    }
    throw err
  }
}
