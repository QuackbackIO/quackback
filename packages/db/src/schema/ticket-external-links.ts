import { pgTable, text, timestamp, varchar, index, unique, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { tickets } from './tickets'
import { integrations } from './integrations'

/**
 * External links between tickets and external platform issues.
 * Created when an outbound hook creates an issue in an external tracker,
 * or when an inbound webhook creates a ticket from an external issue.
 * Used for reverse lookups during bidirectional sync.
 */
export const ticketExternalLinks = pgTable(
  'ticket_external_links',
  {
    id: typeIdWithDefault('linked_entity')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id').notNull(),
    // Nullable: manually-created links don't require a full integration record
    integrationId: typeIdColumnNullable('integration')('integration_id'),
    integrationType: varchar('integration_type', { length: 50 }).notNull(),
    externalId: text('external_id').notNull(),
    /** Human-friendly display label (e.g. "#142"). Falls back to externalId when null. */
    externalDisplayId: text('external_display_id'),
    externalUrl: text('external_url'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    /** Direction this link was created from: outbound (ticket→issue), inbound (issue→ticket), bidirectional */
    syncDirection: varchar('sync_direction', { length: 20 }).notNull().default('outbound'),
    /** Last time this link's data was verified/synced with the external system */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'ticket_external_links_ticket_fk',
      columns: [table.ticketId],
      foreignColumns: [tickets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ticket_external_links_integration_fk',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    // One external issue can link to one ticket per type (unique per type+externalId+ticketId)
    unique('ticket_external_links_type_external_ticket_unique').on(
      table.integrationType,
      table.externalId,
      table.ticketId
    ),
    index('ticket_external_links_ticket_id_idx').on(table.ticketId),
    index('ticket_external_links_type_external_id_idx').on(table.integrationType, table.externalId),
    index('ticket_external_links_ticket_status_idx').on(table.ticketId, table.status),
  ]
)

// Relations
export const ticketExternalLinksRelations = relations(ticketExternalLinks, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketExternalLinks.ticketId],
    references: [tickets.id],
  }),
  integration: one(integrations, {
    fields: [ticketExternalLinks.integrationId],
    references: [integrations.id],
  }),
}))
