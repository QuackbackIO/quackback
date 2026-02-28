import { pgTable, text, timestamp, varchar, index, unique, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { posts } from './posts'
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
    id: typeIdWithDefault('linked_entity')('id').primaryKey(),
    postId: typeIdColumn('post')('post_id').notNull(),
    // Nullable: sidebar-created links don't require a full integration record
    integrationId: typeIdColumnNullable('integration')('integration_id'),
    integrationType: varchar('integration_type', { length: 50 }).notNull(),
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url'),
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
    // Allow one ticket to link to multiple posts (unique per type+externalId+postId)
    unique('post_external_links_type_external_post_unique').on(
      table.integrationType,
      table.externalId,
      table.postId
    ),
    index('post_external_links_post_id_idx').on(table.postId),
    index('post_external_links_type_external_id_idx').on(table.integrationType, table.externalId),
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
