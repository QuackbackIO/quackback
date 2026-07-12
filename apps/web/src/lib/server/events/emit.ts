/**
 * `emit()` — write one durable event to the outbox, in the caller's transaction
 * (EVENTING-V2 §2.3 / WO-1).
 *
 * This is the ONLY sanctioned way to raise a domain event. It validates the
 * payload against the catalogue definition, INSERTs one `events` row on the
 * passed transaction (so the event commits atomically with the mutation), writes
 * an `audit_log` row in the same transaction when the definition opts in, and
 * fires the commit-time doorbell (`pg_notify 'outbox_wake'`) so the relay wakes
 * immediately. It NEVER enqueues BullMQ — the relay is the sole enqueuer.
 */
import { db, events, auditLog, sql, type Database, type Transaction } from '@/lib/server/db'
import { createId, type EvtId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import type { EventDefinition } from './catalogue/define'
import type { DomainEvent, EventActorType, EventContext } from './envelope'

const log = logger.child({ component: 'emit' })

/** A drizzle handle that can carry the emission: the caller's tx (normal) or db. */
export type DbOrTx = Database | Transaction

export interface EmitInput<P> {
  payload: P
  actor: { type: EventActorType; id?: string }
  /** Branded TypeID of the subject aggregate. */
  entityId: string
  /** inherit() bumps depth/causation from a triggering event. */
  context?: Partial<EventContext>
  /** Scheduler/retry idempotency; a duplicate insert violates events_dedupe_idx. */
  dedupeKey?: string | null
}

/**
 * Validate + persist one event on the caller's transaction, then ring the
 * commit-time doorbell. Returns the new event's TypeID.
 */
export async function emit<P>(
  tx: DbOrTx,
  def: EventDefinition<P>,
  input: EmitInput<P>
): Promise<EvtId> {
  // Validate the payload against the catalogue schema. A bad payload is a
  // programming error — throw synchronously inside the tx so it rolls back.
  const payload = def.payload.parse(input.payload)

  const eventId = createId('event')
  const context: EventContext = { depth: 0, ...input.context }

  await tx.insert(events).values({
    eventId,
    type: def.type,
    entityType: def.entity,
    entityId: input.entityId,
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    payload: payload as unknown as Record<string, unknown>,
    context: context as unknown as Record<string, unknown>,
    schemaVersion: def.version,
    dedupeKey: input.dedupeKey ?? null,
  })

  // Compliance audit rows are written in the SAME transaction when the
  // definition opts in — this fixes audit_log's historical best-effort,
  // out-of-transaction loss window (an aborted mutation no longer leaves an
  // orphan audit row, and a committed one always has its audit trail).
  if (def.exposure.audit) {
    await tx.insert(auditLog).values({
      eventType: def.type,
      eventOutcome: 'success',
      actorType: input.actor.type,
      targetType: def.entity,
      targetId: input.entityId,
      afterValue: payload as unknown as Record<string, unknown>,
      requestId: context.correlationId ?? null,
      metadata: { eventId, source: context.source ?? null },
    })
  }

  // Commit-time doorbell: Postgres delivers this NOTIFY only if the tx commits,
  // so the relay is woken exactly when there is a durably-committed event to
  // drain — and never for a rolled-back one.
  await tx.execute(sql`select pg_notify('outbox_wake', '')`)

  return eventId
}

/**
 * Emit in a fresh short transaction, best-effort — for WO-6 emission from
 * services that have no surrounding transaction. Never throws: a failed audit/
 * outbox write must not fail the domain mutation that already committed. Prefer
 * the in-tx `emit()` when the caller already owns a transaction.
 */
export async function emitBestEffort<P>(
  def: EventDefinition<P>,
  input: EmitInput<P>
): Promise<void> {
  try {
    await db.transaction((tx) => emit(tx, def, input))
  } catch (error) {
    log.warn({ err: error, type: def.type }, 'best-effort emit failed')
  }
}

/**
 * Build a child context from a triggering event: depth+1, causationId set to the
 * parent's id, correlationId propagated. Used when a reaction (e.g. a workflow
 * action) causes a further mutation, so the relay's depth guard can break loops.
 */
export function inherit(parent: DomainEvent, source?: string): Partial<EventContext> {
  return {
    depth: parent.context.depth + 1,
    causationId: parent.eventId,
    correlationId: parent.context.correlationId,
    source: source ?? parent.context.source,
  }
}
