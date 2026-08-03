import { pgTable, text, timestamp, varchar, index, unique, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { tickets, ticketThreads } from './tickets'
import { integrations } from './integrations'

/**
 * External links between ticket threads and external platform comments.
 * Used for bidirectional comment sync and webhook retry idempotency.
 */
export const ticketThreadExternalLinks = pgTable(
  'ticket_thread_external_links',
  {
    id: typeIdWithDefault('linked_entity')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id').notNull(),
    threadId: typeIdColumn('ticket_thread')('thread_id').notNull(),
    integrationId: typeIdColumn('integration')('integration_id').notNull(),
    integrationType: varchar('integration_type', { length: 50 }).notNull(),
    externalIssueId: text('external_issue_id').notNull(),
    externalCommentId: text('external_comment_id').notNull(),
    externalUrl: text('external_url'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    syncDirection: varchar('sync_direction', { length: 20 }).notNull().default('outbound'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'ticket_thread_external_links_ticket_fk',
      columns: [table.ticketId],
      foreignColumns: [tickets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ticket_thread_external_links_thread_fk',
      columns: [table.threadId],
      foreignColumns: [ticketThreads.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ticket_thread_external_links_integration_fk',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    unique('ticket_thread_external_links_integration_comment_unique').on(
      table.integrationId,
      table.externalCommentId
    ),
    unique('ticket_thread_external_links_integration_thread_unique').on(
      table.integrationId,
      table.threadId
    ),
    index('ticket_thread_external_links_ticket_idx').on(table.ticketId),
    index('ticket_thread_external_links_issue_idx').on(table.integrationId, table.externalIssueId),
    index('ticket_thread_external_links_thread_status_idx').on(table.threadId, table.status),
  ]
)

export const ticketThreadExternalLinksRelations = relations(
  ticketThreadExternalLinks,
  ({ one }) => ({
    ticket: one(tickets, {
      fields: [ticketThreadExternalLinks.ticketId],
      references: [tickets.id],
    }),
    thread: one(ticketThreads, {
      fields: [ticketThreadExternalLinks.threadId],
      references: [ticketThreads.id],
    }),
    integration: one(integrations, {
      fields: [ticketThreadExternalLinks.integrationId],
      references: [integrations.id],
    }),
  })
)
