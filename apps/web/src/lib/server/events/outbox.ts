/**
 * Shared outbox helpers used by job-owned event dispatch.
 *
 * The former outbox relay (`LISTEN outbox_wake` + `drainOnce`) is gone.
 * `emit()` writes an `event-dispatch` job in the same transaction as the
 * outbox row; `runEventDispatch` is the only drain.
 */
import { events } from '@/lib/server/db'
import type { EvtId } from '@quackback/ids'
import type { DomainEvent, EventActorType } from './envelope'

type EventRow = typeof events.$inferSelect

/** Reaction-chain ceiling: an event caused >5 hops deep is a loop — halt it. */
export const MAX_DEPTH = 5

/**
 * Strict-resolution retry budget. Destination failure throws so the job
 * retries; after this many attempts the handler degrades to best-effort
 * resolution — healthy sinks deliver, the failing sink is dropped.
 */
export const MAX_STRICT_RESOLVE_ATTEMPTS = 10

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
