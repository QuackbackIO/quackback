/**
 * Transitional bridge (WO-4): write a legacy `EventData` to the durable outbox
 * via `emit()`, instead of the old fire-and-forget resolve+enqueue. Used by
 * `processEvent` when the EVENTING-V2 flag is on. Phase 1 moves emission into
 * each domain service's own transaction and retires this generic bridge.
 *
 * Because the existing dispatchers run AFTER their mutation has committed (no tx
 * in scope), this opens a short transaction solely to write the outbox row —
 * still strictly better than fire-and-forget, since the row + its pg_notify are
 * atomic and the relay guarantees at-least-once delivery.
 */
import { db } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { isUniqueViolation } from '@/lib/server/utils'
import { emit } from './emit'
import { getEventDefinition } from './catalogue'
import { TIMER_DRIVEN_EVENT_TYPES, type EventData } from './types'
import type { EventActorType } from './envelope'

const log = logger.child({ component: 'outbox-dispatch' })

/**
 * Timer-driven events dispatched with a CALLER-SUPPLIED deterministic `event.id`
 * (see dispatch.ts `timerEventEnvelope`). Their idempotency across repeated sweep
 * ticks relied on the queue keying its job off that deterministic id — but the
 * outbox mints a FRESH `eventId` per row, so without a dedupe key a later tick
 * over the same still-qualifying condition would write a new row and re-fire.
 * For these types we thread the deterministic id into the outbox `dedupeKey`, so
 * `events_dedupe_idx` collapses repeated ticks the way the queue used to. Scoped
 * to the transitional bridge deliberately: everyday events carry no dedupe key
 * (keeping the partial index lean) and gain it only when they move to native
 * `emit()` with their own idempotency needs.
 */
const TIMER_DEDUPED_TYPES = new Set<EventData['type']>(TIMER_DRIVEN_EVENT_TYPES)

/** Map the legacy actor union onto the outbox actor {type,id}. */
function mapActor(actor: EventData['actor']): { type: EventActorType; id?: string } {
  if (actor.type === 'user') {
    return { type: 'user', id: actor.principalId ?? actor.userId }
  }
  return { type: 'service', id: actor.principalId }
}

/**
 * Best-effort subject id for an event, dug from the known `data` shapes. Falls
 * back to the event id so a row is never rejected for a missing entity id (the
 * per-type precision lands with the hardened payloads in WO-5).
 */
export function extractEntityId(event: EventData): string {
  const d = event.data as unknown as Record<string, unknown>
  const pick = (obj: unknown): string | undefined =>
    obj && typeof obj === 'object' && 'id' in (obj as Record<string, unknown>)
      ? String((obj as { id: unknown }).id)
      : undefined

  return (
    pick(d.post) ??
    pick(d.duplicatePost) ??
    pick(d.comment) ??
    pick(d.changelog) ??
    pick(d.conversation) ??
    pick(d.message) ??
    pick(d.ticket) ??
    pick(d.incident) ??
    (typeof d.conversationId === 'string' ? d.conversationId : undefined) ??
    (typeof d.postId === 'string' ? d.postId : undefined) ??
    (typeof d.incidentId === 'string' ? d.incidentId : undefined) ??
    (typeof d.componentId === 'string' ? d.componentId : undefined) ??
    event.id
  )
}

/**
 * Write one legacy event to the outbox. Returns true if written, false if the
 * type has no catalogue entry (defensive — the coverage test makes this
 * impossible for real EVENT_TYPES, but a stray call shouldn't throw).
 */
export async function writeEventToOutbox(event: EventData): Promise<boolean> {
  const def = getEventDefinition(event.type)
  if (!def) {
    log.warn({ type: event.type }, 'no catalogue definition for event; not written to outbox')
    return false
  }
  const dedupeKey = TIMER_DEDUPED_TYPES.has(event.type) ? event.id : null
  try {
    await db.transaction((tx) =>
      emit(tx, def, {
        payload: event.data as unknown as Record<string, unknown>,
        actor: mapActor(event.actor),
        entityId: extractEntityId(event),
        context: { source: event.actor.service, correlationId: event.id },
        dedupeKey,
      })
    )
  } catch (error) {
    // A dedupe-key collision means this exact timer event was already written on
    // an earlier tick — the intended fire-once outcome, not an error. Swallow it
    // (the row is durably present from the first tick) and don't re-log it as a
    // dispatch failure. Any other failure propagates.
    if (dedupeKey && isUniqueViolation(error)) {
      log.debug(
        { type: event.type, dedupeKey },
        'duplicate timer event skipped (already in outbox)'
      )
      return true
    }
    throw error
  }
  return true
}
