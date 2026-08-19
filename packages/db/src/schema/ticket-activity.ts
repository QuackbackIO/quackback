import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { tickets } from './tickets'
import { principal } from './auth'

/**
 * Ticket activity log — tracks all meaningful state changes on tickets
 * (mirrors post_activity, the posts-side log).
 *
 * Each row represents a single activity event: status change, assignment,
 * priority change, reopen, etc. The principal_id records who performed the
 * action (null for system-initiated actions). Type-specific details are
 * stored in the metadata JSONB column.
 */
export const ticketActivity = pgTable(
  'ticket_activity',
  {
    id: typeIdWithDefault('ticket_activity')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ticket_activity_ticket_id_created_idx').on(t.ticketId, t.createdAt),
    index('ticket_activity_type_idx').on(t.type),
  ]
)

export const ticketActivityRelations = relations(ticketActivity, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketActivity.ticketId],
    references: [tickets.id],
    relationName: 'ticketActivity',
  }),
  actor: one(principal, {
    fields: [ticketActivity.principalId],
    references: [principal.id],
    relationName: 'ticketActivityActor',
  }),
}))
