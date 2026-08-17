/**
 * Outbox relay (EVENTING-V2 WO-3) — draining the `events` outbox into the hook
 * fan-out.
 *
 * This file owns what a drain IS: read order, the reaction-loop depth ceiling,
 * the strict-resolution retry budget, and at-least-once emission. Where the
 * drain RUNS — one loop per workspace, on direct session-mode connections, elected
 * by a lease rather than an advisory lock — is `relay-tier.ts`
 * (SAAS-HOSTING-STACK.md §7.3).
 *
 * Flow: a committed `emit()` fires `pg_notify('outbox_wake')`; the workspace's
 * leader loop (one per database, elected by the lease in `relay-leader.ts`)
 * wakes, reads unpublished rows in `id` order, resolves targets via the resolver
 * registry, enqueues one job per target with a DETERMINISTIC job id, then stamps
 * `published_at`. Enqueue happens BEFORE the publish stamp, so a crash mid-drain
 * re-drains the row and the deterministic job id makes the re-enqueue a no-op
 * (the whole fan-out is one `INSERT … ON CONFLICT (queue, dedupe_key) DO NOTHING`,
 * plus `hook_deliveries`): at-least-once emission, effectively-once delivery.
 *
 * Reaction-loop guard: events whose `context.depth` exceeds MAX_DEPTH are NOT
 * fanned out (they'd be a workflow-caused-event cycle) but ARE marked published
 * so they are not lost or retried.
 */
import crypto from 'crypto'
import { db, events, eq, isNull, asc, sql, type Transaction } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'
import { enqueueHookJobsWithIds } from './process'
import { resolveTargets } from './resolvers/registry'
import type { DomainEvent, EventActorType } from './envelope'
import type { HookTarget } from './hook-types'
import { toLegacyEvent } from './to-legacy-event'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
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

/**
 * The earliest unpublished outbox row's due time.
 *
 * Read by the relay on the connection it is about to drop, matching the job
 * tier's detach-time deadline. Unpublished rows are due at `occurred_at` —
 * a scheduled delivery that has not been stamped `published_at` yet. Null
 * means the outbox is empty and the detached wait may sleep on the rescan
 * floor alone.
 */
export async function earliestUndeliveredOutboxAt(): Promise<Date | null> {
  const result = await db.execute(sql`
    SELECT min(occurred_at) AS occurred_at FROM events WHERE published_at IS NULL
  `)
  const rows = getExecuteRows<{ occurred_at: Date | string | null }>(result)
  const value = rows[0]?.occurred_at ?? null
  if (value === null) return null
  return value instanceof Date ? value : new Date(value)
}

export interface DrainResult {
  drained: number
  enqueued: number
  skipped: number
  /** Rows left unpublished this pass because resolve/enqueue threw (retried next tick). */
  failed: number
  /**
   * Per row published this pass: this process's clock at publish minus the
   * row's `occurred_at`.
   *
   * This is the relay's end-to-end latency, and it is deliberately measured
   * here rather than by whatever started the relay. A harness that times its own
   * `setTimeout`, or that stops the clock when a NOTIFY arrives rather than when
   * the row is actually published, reports the instrument instead of the system.
   * Every row published contributes a sample, whether its doorbell fired or the
   * poll floor caught it, so the two are on one scale.
   */
  lagMsSamples: number[]
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

/**
 * Per workspace, because `events.id` is a per-database bigserial.
 *
 * Two workspaces both have an event 5, and they are not the same row. Shared,
 * one workspace's ten failed resolutions spend another workspace's retry budget
 * for an unrelated event, which then degrades to best-effort resolution and
 * **drops that event's targets** on its first attempt. The budget exists
 * precisely so that does not happen without ten tries first.
 */
const strictAttempts = new WorkspaceKeyedCache<number>(20_000)

/** Keys are bigints; the cache is string-keyed, so name the conversion once. */
const attemptKey = (id: bigint): string => id.toString()

/**
 * Drain one batch of unpublished events. Pure enough to unit-test: the enqueue
 * and resolve steps are injectable so the ordering/idempotency/depth-guard logic
 * can be verified against a live DB without standing up the job tier.
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
  // Best-effort degradation only means something against the real multi-sink
  // registry; an injected resolver (tests) always runs strict.
  const usingRegistryResolver = opts.resolve === undefined
  const maxAttempts = opts.maxStrictResolveAttempts ?? MAX_STRICT_RESOLVE_ATTEMPTS

  const rows = await db
    .select()
    .from(events)
    .where(isNull(events.publishedAt))
    .orderBy(asc(events.id))
    .limit(batchSize)

  // Rows drain in ascending id order, so every retry-ledger key below the
  // smallest still-unpublished id belongs to a row some leader already
  // published — prune them so leadership churn can't leak entries.
  //
  // Both branches address only the ACTIVE workspace's ledger. A fleet-wide
  // `clear()` here would reset every other workspace's retry budgets because
  // this one happened to have an empty outbox.
  if (rows.length > 0) {
    for (const key of strictAttempts.workspaceKeys()) {
      if (BigInt(key) < rows[0].id) strictAttempts.delete(key)
    }
  } else {
    strictAttempts.clearWorkspace()
  }

  let enqueued = 0
  let skipped = 0
  let failed = 0
  const lagMsSamples: number[] = []

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
      lagMsSamples.push(Math.max(0, Date.now() - row.occurredAt.getTime()))
      skipped++
      continue
    }

    try {
      const attempts = strictAttempts.get(attemptKey(row.id)) ?? 0
      const degraded = attempts >= maxAttempts
      // Past the strict budget the failure is deterministic, not transient:
      // fall back to best-effort so healthy sinks still deliver instead of the
      // row wedging in place.
      const targets =
        degraded && usingRegistryResolver
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
      lagMsSamples.push(Math.max(0, Date.now() - row.occurredAt.getTime()))
      strictAttempts.delete(attemptKey(row.id))
      if (degraded) {
        log.error(
          { event_id: event.eventId, type: event.type, attempts },
          'event published via best-effort resolution after strict retries exhausted — a failing sink was skipped'
        )
      }
    } catch (err) {
      const attempts = (strictAttempts.get(attemptKey(row.id)) ?? 0) + 1
      strictAttempts.set(attemptKey(row.id), attempts)
      failed++
      log.error(
        { err, event_id: event.eventId, type: event.type, attempts },
        'outbox row failed to resolve/enqueue — left unpublished for retry'
      )
      // continue: the rows behind this one still drain (no head-of-line block).
    }
  }

  return { drained: rows.length, enqueued, skipped, failed, lagMsSamples }
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
// Where the loop went
// ---------------------------------------------------------------------------
//
// The leader loop used to live here: five module-scope variables (`running`,
// `leadership`, `pollTimer`, `retryTimer`, `draining`) describing ONE database's
// relay, plus a session-level `pg_advisory_lock` on a dedicated connection.
//
// That shape cannot serve a fleet. Every one of those five is a fact about a
// single database, so in a process holding many they would elect a leader for
// whichever database the process happened to hold and silently deliver nothing
// for the rest — which is why the pooled branch refused to start at all rather
// than run a 15-second retry loop that delivered nothing.
//
// `relay-tier.ts` replaces it with one loop per workspace, each owning its own
// direct connection, its own doorbell, its own lease and its own counters in a
// closure. There is no shared object left to key wrongly. The state that
// remains in this file is `strictAttempts`, which is workspace-keyed because
// `events.id` is a per-database bigserial.
//
// See `RELAY.md` for the whole tier, and `relay-leader.ts` for why the advisory
// lock was replaced by a lease row.
