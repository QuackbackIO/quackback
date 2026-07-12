/**
 * The event catalogue: one `defineEvent` declaration per event type
 * (EVENTING-V2 §2.2). A single declaration is the source of truth that feeds
 * every downstream surface — webhook pickers + OpenAPI, workflow triggers, the
 * notification matrix keys, and the CI coverage gate — killing the ~5-file edit
 * and the "webhook advertises 4 events, supports 30" drift.
 *
 * This module (WO-1/WO-2 boundary) provides the machinery + registry. The
 * per-entity catalogue files (WO-2) call `defineEvent` at import time to
 * populate the registry. `emit()` takes an `EventDefinition` directly, so it
 * depends only on the interface here — not on any particular catalogue entry.
 */
import type { z } from 'zod'

/**
 * Everywhere an event kind is exposed. Declared once, consumed by every
 * downstream surface so they can never drift out of sync.
 */
export interface EventExposure {
  /** Appears in app/webhook subscription pickers + OpenAPI webhook schemas. */
  webhook: boolean
  /** Becomes a workflow trigger. */
  workflow: boolean
  /** Key into the notification matrix (null = not a notification). */
  notification: string | null
  /** Documents the paired activity silo (post_activity, ...); does NOT automate it. */
  activity: string | null
  /** Also write an audit_log row in the same transaction as the mutation. */
  audit: boolean
}

export interface EventDefinition<P> {
  /** '<entity>.<verb>'. */
  type: string
  entity: string
  version: number
  /** Zod schema for the payload; validated at emit time. */
  payload: z.ZodType<P>
  exposure: EventExposure
  /** Shared scope vocabulary; gates app subscriptions to this event. */
  requiredScope: string
  /**
   * 'always' = a call site is expected (CI coverage enforces it).
   * 'never'  = intentionally silent (hot paths: votes, reactions, view counters).
   *            Declared so the coverage test passes without emitting spam.
   */
  emits: 'always' | 'never'
}

const registry = new Map<string, EventDefinition<unknown>>()

/**
 * Declare an event kind and register it. Called at import time from the
 * per-entity catalogue files. Throws on a duplicate type so two catalogue
 * files can't silently claim the same key.
 */
export function defineEvent<P>(
  type: string,
  def: Omit<EventDefinition<P>, 'type'>
): EventDefinition<P> {
  if (registry.has(type)) {
    throw new Error(`Duplicate event definition for "${type}"`)
  }
  const full: EventDefinition<P> = { type, ...def }
  registry.set(type, full as EventDefinition<unknown>)
  return full
}

/** Registry lookup by type key (used by the relay to hydrate/validate). */
export function getEventDefinition(type: string): EventDefinition<unknown> | undefined {
  return registry.get(type)
}

/** All registered definitions (used by the coverage test + surface generators). */
export function allEventDefinitions(): ReadonlyArray<EventDefinition<unknown>> {
  return [...registry.values()]
}

/** Test-only: clear the registry between suites that re-import catalogue files. */
export function __resetCatalogueForTests(): void {
  registry.clear()
}
