/**
 * The canonical domain-event envelope (EVENTING-V2 §2.1 / WO-1).
 *
 * `DomainEvent` is the in-memory shape a consumer sees, hydrated from an
 * `events` outbox row by the relay. Emission writes the row (see `emit.ts`);
 * the relay reads it back and resolves targets. These types are FROZEN — every
 * resolver, the relay, and the catalogue build against them, so a change here
 * ripples across the whole spine.
 */
import type { EvtId } from '@quackback/ids'

/**
 * Who or what caused an event.
 * Mirrors `principalType` ('user' | 'anonymous' | 'service'), plus 'system' for
 * non-attributable automated origins (scheduled sweeps, SLA deadline scans)
 * that carry no principal.
 */
export type EventActorType = 'user' | 'anonymous' | 'service' | 'system'

export interface EventContext {
  /** Request/trace id; propagated across events caused by this one. */
  correlationId?: string
  /** event_id of the event that caused this one — reaction-loop tracing. */
  causationId?: string
  /** 0 for user-originated; +1 per reaction-caused mutation. Relay refuses > 5. */
  depth: number
  /** Provenance: 'api' | 'admin' | 'widget' | 'scheduler' | 'workflow' | 'import' | ... */
  source?: string
}

/** The canonical in-memory event, hydrated from an `events` row. */
export interface DomainEvent<P = unknown> {
  /** TypeID 'evt_...'. */
  eventId: EvtId
  /** Global monotonic sequence (events.id). */
  seq: bigint
  /** Catalogue key, e.g. 'post.status_changed'. */
  type: string
  /** Aggregate kind, e.g. 'post'. */
  entityType: string
  /** Branded TypeID of the subject. */
  entityId: string
  actorType: EventActorType
  actorId?: string
  /** Validated against the catalogue zod schema at emit time. */
  payload: P
  context: EventContext
  schemaVersion: number
  occurredAt: Date
}
