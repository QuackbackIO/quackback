import { pgTable, text, timestamp, varchar, index, unique, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { posts } from './posts'
import { tickets } from './tickets'
import { integrations } from './integrations'

/**
 * External links between posts and external platform issues/tickets.
 * Created when an outbound hook creates an issue in an external tracker,
 * or when a support agent links a ticket to a post via the sidebar app.
 * Used for reverse lookups when inbound webhooks report status changes.
 */
export const postExternalLinks = pgTable(
  'post_external_links',
  {
    id: typeIdWithDefault('post_external_link')('id').primaryKey(),
    postId: typeIdColumn('post')('post_id').notNull(),
    // Nullable: sidebar-created links don't require a full integration record
    integrationId: typeIdColumnNullable('integration')('integration_id'),
    integrationType: varchar('integration_type', { length: 50 }).notNull(),
    externalId: text('external_id').notNull(),
    /** Human-friendly display label (e.g. "QUA-24", "#142"). Falls back to externalId when null. */
    externalDisplayId: text('external_display_id'),
    externalUrl: text('external_url'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    /** Cached remote presentation (WO-14) — display only, refreshed by inbound webhooks. */
    remoteTitle: text('remote_title'),
    remoteState: varchar('remote_state', { length: 64 }),
    remoteStateAt: timestamp('remote_state_at', { withTimezone: true }),
    /** Provenance (WO-14): which seam created the link — 'event' | 'push' | 'reference' | 'sidebar'. */
    origin: varchar('origin', { length: 20 }),
    createdByPrincipalId: text('created_by_principal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'post_external_links_post_fk',
      columns: [table.postId],
      foreignColumns: [posts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'post_external_links_integration_fk',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    // Allow one ticket to link to multiple posts (unique per type+externalId+postId).
    // Columns listed alphabetically: drizzle-kit introspects multi-column UNIQUE
    // constraints in alphabetical order, and the drift check compares that order.
    unique('post_external_links_type_external_post_unique').on(
      table.externalId,
      table.integrationType,
      table.postId
    ),
    index('post_external_links_post_status_idx').on(table.postId, table.status),
  ]
)

// Relations
export const postExternalLinksRelations = relations(postExternalLinks, ({ one }) => ({
  post: one(posts, {
    fields: [postExternalLinks.postId],
    references: [posts.id],
  }),
  integration: one(integrations, {
    fields: [postExternalLinks.integrationId],
    references: [integrations.id],
  }),
}))

/**
 * External links between tickets and external platform issues (a deliberate
 * sibling of post_external_links, not a second nullable parent on it — the
 * post table's postId is notNull and its consumers assume post-only). Created
 * when a teammate manually links a ticket to an existing tracker issue; used
 * for reverse lookups when inbound webhooks report issue state changes.
 */
export const ticketExternalLinks = pgTable(
  'ticket_external_links',
  {
    id: typeIdWithDefault('ticket_external_link')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id').notNull(),
    // Nullable to mirror post_external_links (sidebar-style links without a
    // full integration record); the manual link path always sets it.
    integrationId: typeIdColumnNullable('integration')('integration_id'),
    integrationType: varchar('integration_type', { length: 50 }).notNull(),
    externalId: text('external_id').notNull(),
    /** Human-friendly display label (e.g. "acme/widgets#142"). Falls back to externalId when null. */
    externalDisplayId: text('external_display_id'),
    externalUrl: text('external_url'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    /** Cached remote presentation (WO-14) — display only, refreshed by inbound webhooks. */
    remoteTitle: text('remote_title'),
    remoteState: varchar('remote_state', { length: 64 }),
    remoteStateAt: timestamp('remote_state_at', { withTimezone: true }),
    /** Provenance (WO-14): which seam created the link — 'event' | 'push' | 'reference' | 'sidebar'. */
    origin: varchar('origin', { length: 20 }),
    createdByPrincipalId: text('created_by_principal_id'),
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
    // Allow one issue to link to multiple tickets (unique per type+externalId+ticketId).
    // Columns listed alphabetically: drizzle-kit introspects multi-column UNIQUE
    // constraints in alphabetical order, and the drift check compares that order.
    unique('ticket_external_links_type_external_ticket_unique').on(
      table.externalId,
      table.integrationType,
      table.ticketId
    ),
    index('ticket_external_links_type_external_id_idx').on(table.integrationType, table.externalId),
    index('ticket_external_links_ticket_status_idx').on(table.ticketId, table.status),
  ]
)

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
