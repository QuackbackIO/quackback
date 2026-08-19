/**
 * DomainEvent → legacy EventData adapter (EVENTING-V2 transitional).
 *
 * The existing hook handlers and the notification target builders in targets.ts
 * consume the legacy `EventData` shape. Until Phase 5 makes them DomainEvent-
 * native, the relay and the notification resolver reconstruct EventData at the
 * boundary from the outbox row's payload + actor.
 *
 * Actor fidelity caveat: the envelope stores actorType + actorId (the principal
 * id) but not the actor's email/displayName. Consumers that key off those (e.g.
 * the "don't notify yourself" filter) should compare by principalId; WO-6's
 * in-service emission carries the full actor context.
 */
import type { DomainEvent } from './envelope'
import type { EventData, EventActor } from './types'

export function toLegacyEvent(event: DomainEvent): EventData {
  const actor: EventActor =
    event.actorType === 'user'
      ? { type: 'user', principalId: event.actorId, userId: undefined }
      : { type: 'service', principalId: event.actorId, displayName: event.context.source }
  return {
    id: event.eventId,
    type: event.type,
    timestamp: event.occurredAt.toISOString(),
    actor,
    data: event.payload,
  } as unknown as EventData
}
