/**
 * Outbox relay (EVENTING-V2 WO-3) — the worker-role process that drains the
 * `events` outbox into the existing `{event-hooks}` BullMQ fan-out.
 *
 * Flow: a committed `emit()` fires `pg_notify('outbox_wake')`; the leader relay
 * (one per instance, advisory-lock elected) wakes, reads unpublished rows in
 * `id` order, resolves targets via the resolver registry, enqueues one job per
 * target with a DETERMINISTIC job id, then stamps `published_at`. Enqueue
 * happens BEFORE the publish stamp, so a crash mid-drain re-drains the row and
 * the deterministic job id makes the re-enqueue a no-op (BullMQ dedupe +
 * `hook_deliveries`) — at-least-once emission, effectively-once delivery.
 *
 * Reaction-loop guard: events whose `context.depth` exceeds MAX_DEPTH are NOT
 * fanned out (they'd be a workflow-caused-event cycle) but ARE marked published
 * so they are not lost or retried.
 */
import crypto from 'crypto'
import { db, events, eq, isNull, asc, type Transaction } from '@/lib/server/db'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'
import { enqueueHookJobsWithIds } from './process'
import { resolveTargets } from './resolvers/registry'
import { registerAllResolvers } from './resolvers'
import { tryAcquireRelayLeadership, type RelayLeadership } from './relay-lock'
import type { DomainEvent, EventActorType } from './envelope'
import type { HookTarget } from './hook-types'
import { toLegacyEvent } from './to-legacy-event'
import type { EvtId } from '@quackback/ids'

const log = logger.child({ component: 'outbox-relay' })

/** Reaction-chain ceiling: an event caused >5 hops deep is a loop — halt it. */
export const MAX_DEPTH = 5

type EventRow = typeof events.$inferSelect

/** Hydrate the in-memory DomainEvent from an outbox row. */
export function hydrateEvent(row: EventRow): DomainEvent {
  return {
    eventId: row.eventId as EvtId,
    seq: row.id,
    type: row.type,
    entityType: row.entityType,
    entityId: row.entityId,
    actorType: row.actorType as EventActorType,
    actorId: row.actorId ?? undefined,
    payload: row.payload,
    context: (row.context ?? { depth: 0 }) as DomainEvent['context'],
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt,
  }
}

/** Stable per-target key so the same target always maps to the same job id. */
function targetKey(target: HookTarget): string {
  return crypto
    .createHash('sha256')
    .update(target.deliveryKey ?? JSON.stringify(target.target ?? null))
    .digest('hex')
    .slice(0, 24)
}

async function markPublished(id: bigint, executor: Transaction | typeof db = db): Promise<void> {
  await executor.update(events).set({ publishedAt: new Date() }).where(eq(events.id, id))
}

export interface DrainResult {
  drained: number
  enqueued: number
  skipped: number
  /** Rows left unpublished this pass because resolve/enqueue threw (retried next tick). */
  failed: number
}

/**
 * Strict-resolution retry budget per outbox row. Resolution is all-or-retry
 * (see resolveTargets): a failing sink leaves the row unpublished so nothing is
 * silently dropped. But an event that fails resolution DETERMINISTICALLY would
 * retry forever, so after this many failed passes the relay degrades to
 * best-effort resolution — healthy sinks deliver, the failing sink's targets
 * are dropped with a loud error — and the row is published. Kept in memory:
 * the relay is a leader-elected singleton, and a leader change merely restarts
 * a row's count (more strict retries, never fewer).
 */
export const MAX_STRICT_RESOLVE_ATTEMPTS = 10
const strictAttempts = new Map<bigint, number>()

/**
 * Drain one batch of unpublished events. Pure enough to unit-test: the enqueue
 * and resolve steps are injectable so the ordering/idempotency/depth-guard logic
 * can be verified against a live DB without standing up Redis.
 *
 * Per-row isolation: a row whose resolve/enqueue throws is left unpublished and
 * retried on a later pass, but it never blocks the rows behind it — one poison
 * event must not stall the whole pipeline.
 */
export async function drainOnce(
  opts: {
    batchSize?: number
    enqueue?: typeof enqueueHookJobsWithIds
    resolve?: (event: DomainEvent) => Promise<HookTarget[]>
    /** Override the strict-resolution retry budget (tests). */
    maxStrictResolveAttempts?: number
  } = {}
): Promise<DrainResult> {
  const batchSize = opts.batchSize ?? 100
  const enqueue = opts.enqueue ?? enqueueHookJobsWithIds
  const resolve = opts.resolve ?? resolveTargets
  const maxAttempts = opts.maxStrictResolveAttempts ?? MAX_STRICT_RESOLVE_ATTEMPTS

  const rows = await db
    .select()
    .from(events)
    .where(isNull(events.publishedAt))
    .orderBy(asc(events.id))
    .limit(batchSize)

  let enqueued = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
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
      await markPublished(row.id)
      skipped++
      continue
    }

    try {
      const attempts = strictAttempts.get(row.id) ?? 0
      const degraded = attempts >= maxAttempts
      // Past the strict budget the failure is deterministic, not transient:
      // fall back to best-effort so healthy sinks still deliver instead of the
      // row wedging in place. (Injected resolvers don't carry the bestEffort
      // mode — tests drive the strict path explicitly.)
      const targets =
        degraded && opts.resolve === undefined
          ? await resolveTargets(event, { bestEffort: true })
          : await resolve(event)
      if (targets.length > 0) {
        const legacy = toLegacyEvent(event)
        const jobs = targets.map((t) => ({
          name: `${event.type}:${t.type}`,
          data: { hookType: t.type, event: legacy, target: t.target, config: t.config },
          // Deterministic: re-draining the same row re-enqueues the same id.
          jobId: `${event.eventId}:${t.type}:${targetKey(t)}`,
        }))
        // Enqueue BEFORE the publish stamp — at-least-once.
        await enqueue(jobs)
        enqueued += jobs.length
      }
      await markPublished(row.id)
      strictAttempts.delete(row.id)
      if (degraded) {
        log.error(
          { event_id: event.eventId, type: event.type, attempts },
          'event published via best-effort resolution after strict retries exhausted — a failing sink was skipped'
        )
      }
    } catch (err) {
      const attempts = (strictAttempts.get(row.id) ?? 0) + 1
      strictAttempts.set(row.id, attempts)
      failed++
      log.error(
        { err, event_id: event.eventId, type: event.type, attempts },
        'outbox row failed to resolve/enqueue — left unpublished for retry'
      )
      // continue: the rows behind this one still drain (no head-of-line block).
    }
  }

  return { drained: rows.length, enqueued, skipped, failed }
}

/** Age (seconds) of the oldest unpublished event — the "did it fire?" gauge. */
export async function relayLagSeconds(): Promise<number> {
  const rows = await db
    .select({ occurredAt: events.occurredAt })
    .from(events)
    .where(isNull(events.publishedAt))
    .orderBy(asc(events.id))
    .limit(1)
  if (rows.length === 0) return 0
  return Math.max(0, (Date.now() - rows[0].occurredAt.getTime()) / 1000)
}

// ---------------------------------------------------------------------------
// Leader loop
// ---------------------------------------------------------------------------

let running = false
let leadership: RelayLeadership | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let draining = false

async function drainLoop(): Promise<void> {
  if (draining) return
  draining = true
  try {
    let res: DrainResult
    do {
      res = await drainOnce()
      // Keep going only while a pass makes progress. If every remaining row
      // failed (res.failed === res.drained), stop and let the 1s poll retry —
      // otherwise a persistently failing row would hot-spin this loop.
    } while (running && res.drained > 0 && res.failed < res.drained)
  } catch (err) {
    log.error({ err }, 'outbox drain tick failed')
  } finally {
    draining = false
  }
}

/**
 * Start the relay. Worker-role only, so calling it on a web replica is a no-op.
 * Post-cutover (WO-18) the outbox is the sole delivery path — there is no flag
 * to gate it, so a worker-role process ALWAYS runs the relay. Acquires
 * leadership; a non-leader retries periodically so it takes over if the leader
 * dies.
 */
export async function startOutboxRelay(): Promise<void> {
  if (running) return
  if (!shouldRunWorkers()) {
    log.info('QUACKBACK_ROLE=web — outbox relay not started')
    return
  }
  // Ensure every sink resolver is registered before we drain anything.
  registerAllResolvers()
  running = true
  await attemptLeadership()
}

async function attemptLeadership(): Promise<void> {
  if (!running) return
  try {
    leadership = await tryAcquireRelayLeadership()
  } catch (err) {
    log.error({ err }, 'failed to attempt relay leadership')
  }
  if (!leadership) {
    // Another instance leads; retry so we take over if it dies.
    retryTimer = setTimeout(() => void attemptLeadership(), 15_000)
    retryTimer.unref?.()
    return
  }
  // LISTEN doorbell: wake immediately on a committed emit().
  await leadership.sql
    .listen('outbox_wake', () => void drainLoop())
    .catch((err) => log.error({ err }, 'failed to LISTEN outbox_wake'))
  // Poll fallback covers a missed NOTIFY (e.g. crash before LISTEN attached).
  pollTimer = setInterval(() => void drainLoop(), 1000)
  pollTimer.unref?.()
  void drainLoop() // drain any backlog on takeover
  log.info('outbox relay started (leader)')
}

/** Stop the relay and release leadership. Called from graceful shutdown + tests. */
export async function stopOutboxRelay(): Promise<void> {
  running = false
  if (pollTimer) clearInterval(pollTimer)
  if (retryTimer) clearTimeout(retryTimer)
  pollTimer = null
  retryTimer = null
  if (leadership) {
    await leadership.release()
    leadership = null
  }
}
