import { pgTable, timestamp, index, uniqueIndex, varchar, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { tickets } from './tickets'
import { principal } from './auth'

/**
 * Ticket subscriptions ("watchers") - per-ticket watch/unwatch with a
 * temporary mute, mirroring post_subscriptions.
 *
 * One row per (ticket, principal). Unsubscribe deletes the row; a new
 * qualifying interaction (assignment, reply) re-subscribes. Mute is a
 * timestamp: muted_until > now() suppresses watcher notifications, NULL or a
 * past value means active. Per-type/channel preferences stay in the global
 * notification matrix; this table only answers "who follows this ticket".
 */
export type TicketSubscriptionReason = 'requester' | 'assignee' | 'replier' | 'manual'

export const ticketSubscriptions = pgTable(
  'ticket_subscriptions',
  {
    id: typeIdWithDefault('ticket_sub')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id').notNull(),
    principalId: typeIdColumn('principal')('principal_id').notNull(),
    // Provenance: 'requester' | 'assignee' | 'replier' | 'manual'. The first
    // subscribe wins (onConflictDoNothing); unwatch-then-resubscribe refreshes it.
    reason: varchar('reason', { length: 20 }).notNull(),
    // Temporary mute: active while in the future; NULL = not muted.
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Constraint names declared explicitly to match the hand-written migration
    // (0208), which uses the _fkey suffix rather than drizzle's generated name.
    foreignKey({
      name: 'ticket_subscriptions_ticket_id_fkey',
      columns: [table.ticketId],
      foreignColumns: [tickets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ticket_subscriptions_principal_id_fkey',
      columns: [table.principalId],
      foreignColumns: [principal.id],
    }).onDelete('cascade'),
    // One subscription per principal per ticket.
    uniqueIndex('ticket_subscriptions_unique').on(table.ticketId, table.principalId),
    // Fan-out lookup: "who watches this ticket".
    index('ticket_subscriptions_ticket_idx').on(table.ticketId),
    // "My watches" + FK referential-integrity support.
    index('ticket_subscriptions_principal_idx').on(table.principalId),
  ]
)

export const ticketSubscriptionsRelations = relations(ticketSubscriptions, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketSubscriptions.ticketId],
    references: [tickets.id],
  }),
  principal: one(principal, {
    fields: [ticketSubscriptions.principalId],
    references: [principal.id],
  }),
}))
