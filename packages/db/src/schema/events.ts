/**
 * Durable event outbox — the spine of EVENTING-V2 (§2.5 / WO-1).
 *
 * Every domain mutation writes one row here inside its own transaction via
 * `emit(tx, def, ...)`. A worker-role relay drains the unpublished rows (in
 * `id` order) and fans each event out to the existing `{event-hooks}` BullMQ
 * queue, then stamps `published_at`. Because the event row commits atomically
 * with the mutation, the commit-vs-enqueue loss window that fire-and-forget
 * dispatch left open is closed: an event can no longer be dropped by a crash
 * between DB commit and the Redis enqueue.
 *
 * Unpublished rows are the *outbox* (small, hot — served by the partial
 * `events_unpublished_idx`); published rows are the *log* (per-entity timeline,
 * "did it fire?" diagnostics, admin-initiated backfill), retained ~90 days by
 * the WO-20 compactor. This is NOT event sourcing — domain tables remain the
 * source of truth; payloads are minimal snapshots, never a basis for rebuilding
 * state.
 *
 * Single-workspace-per-instance, so `id` is a plain identity sequence: the
 * global monotonic event order. No snowflake ids, no partitioning.
 */
import {
  pgTable,
  bigint,
  text,
  jsonb,
  smallint,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const events = pgTable(
  'events',
  {
    /** Global monotonic sequence — the total event order for this instance. */
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    /** App-facing TypeID ('evt_...'); stable across relay attempts for receiver dedupe. */
    eventId: text('event_id').notNull(),
    /** Catalogue key, e.g. 'post.status_changed'. */
    type: text('type').notNull(),
    /** Aggregate kind, e.g. 'post'. */
    entityType: text('entity_type').notNull(),
    /** Branded TypeID of the subject aggregate. */
    entityId: text('entity_id').notNull(),
    /** 'user' | 'anonymous' | 'service' | 'system'. */
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    /** Validated against the catalogue zod schema before insert. Minimal snapshot. */
    payload: jsonb('payload').notNull(),
    /** { correlationId, causationId, depth, source } — loop tracing + provenance. */
    context: jsonb('context').notNull().default({}),
    schemaVersion: smallint('schema_version').notNull().default(1),
    /** Emission-side idempotency handle (schedulers, retried handlers). */
    dedupeKey: text('dedupe_key'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** NULL = outbox-pending; set by the relay once fanned out. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('events_event_id_idx').on(table.eventId),
    // Hot outbox drain path — partial so it stays tiny regardless of table size.
    index('events_unpublished_idx')
      .on(table.id)
      .where(sql`${table.publishedAt} IS NULL`),
    index('events_entity_idx').on(table.entityType, table.entityId, table.id),
    index('events_type_idx').on(table.type, table.id),
    uniqueIndex('events_dedupe_idx')
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
  ]
)

export type EventRow = typeof events.$inferSelect
export type NewEventRow = typeof events.$inferInsert
