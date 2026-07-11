/**
 * Assistant usage events — append-only, one row per teammate interaction with
 * an AI surface (Quinn Copilot outcome loop): an answer/transform/summary
 * inserted into the composer (metadata.destination says whether it landed as
 * a customer-facing reply or an internal note), or an explicit thumbs up/down
 * on an answer.
 * `event_type` is deliberately open text (no CHECK): new AI surfaces add event
 * kinds without a migration, and the reporting scans filter on the exact types
 * they understand, so an unknown type is simply not counted rather than
 * rejected at write time. Never updated after insert — a "changed mind" on
 * feedback is just another row; readers aggregate, they don't reconcile.
 *
 * Both item FKs are nullable with no exactly-one CHECK (unlike
 * assistant_pending_actions): an event is telemetry about a surface, not a
 * child of the item, and future surfaces (e.g. the admin sandbox) have no item
 * at all. Swept after 180 days by tool-audit.ts's retention job, same cadence
 * as assistant_tool_calls.
 */
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { conversations } from './conversation'
import { tickets } from './tickets'
import { principal } from './auth'

export const assistantEvents = pgTable(
  'assistant_events',
  {
    id: typeIdWithDefault('assistant_event')('id').primaryKey(),
    eventType: text('event_type').notNull(),
    // The acting teammate. SET NULL, not cascade: the event stays countable
    // in the aggregate report after the teammate is deleted.
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    conversationId: typeIdColumnNullable('conversation')('conversation_id').references(
      () => conversations.id,
      { onDelete: 'cascade' }
    ),
    ticketId: typeIdColumnNullable('ticket')('ticket_id').references(() => tickets.id, {
      onDelete: 'cascade',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Drives the Copilot usage report's per-type date-range scan (event_type
    // IN (...) AND created_at range — see analytics/copilot-usage.ts). The
    // retention sweep's DELETE ... WHERE created_at < cutoff runs unindexed:
    // the daily sweep on a 180-day-capped, low-volume table doesn't warrant a
    // second index the way assistant_tool_calls' per-tool breakdown did.
    index('assistant_events_event_type_created_at_idx').on(table.eventType, table.createdAt),
  ]
)

export const assistantEventsRelations = relations(assistantEvents, ({ one }) => ({
  conversation: one(conversations, {
    fields: [assistantEvents.conversationId],
    references: [conversations.id],
  }),
  ticket: one(tickets, {
    fields: [assistantEvents.ticketId],
    references: [tickets.id],
  }),
}))
