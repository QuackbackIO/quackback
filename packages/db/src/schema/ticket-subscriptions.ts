import { pgTable, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { tickets } from './tickets'
import { principal } from './auth'

/**
 * Per-(ticket, principal) subscription rows.
 *
 * Mirrors `post_subscriptions` but adds richer flags appropriate for the
 * ticketing domain (assignment changes, status, participant/share churn,
 * SLA events, …) and a `mutedUntil` window for temporary suppression.
 *
 * `source` differentiates manual subscribes from auto-created ones so the
 * service layer can refuse to overwrite manual preferences with auto values.
 */
export const ticketSubscriptions = pgTable(
  'ticket_subscriptions',
  {
    id: typeIdWithDefault('tkt_sub')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    notifyThreads: boolean('notify_threads').default(true).notNull(),
    notifyProperties: boolean('notify_properties').default(true).notNull(),
    notifyStatus: boolean('notify_status').default(true).notNull(),
    notifyAssignment: boolean('notify_assignment').default(true).notNull(),
    notifyParticipants: boolean('notify_participants').default(false).notNull(),
    notifyShares: boolean('notify_shares').default(false).notNull(),
    notifySla: boolean('notify_sla').default(true).notNull(),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    // CHECK ∈ ('auto_assigned','auto_participant','auto_team_member','manual')
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ticket_subscriptions_unique').on(table.ticketId, table.principalId),
    index('ticket_subscriptions_principal_idx').on(table.principalId, table.ticketId),
    index('ticket_subscriptions_ticket_threads_idx')
      .on(table.ticketId)
      .where(sql`notify_threads = true`),
    index('ticket_subscriptions_ticket_status_idx')
      .on(table.ticketId)
      .where(sql`notify_status = true`),
    index('ticket_subscriptions_ticket_assignment_idx')
      .on(table.ticketId)
      .where(sql`notify_assignment = true`),
    index('ticket_subscriptions_ticket_sla_idx')
      .on(table.ticketId)
      .where(sql`notify_sla = true`),
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

export type TicketSubscriptionSource =
  | 'auto_assigned'
  | 'auto_participant'
  | 'auto_team_member'
  | 'manual'
