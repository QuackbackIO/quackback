import { pgTable, text, timestamp, varchar, index, unique, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { posts } from './posts'
import { integrations } from './integrations'

/**
 * External links between posts and external platform issues.
 * Created when an outbound hook successfully creates an issue in an external tracker.
 * Used for reverse lookups when inbound webhooks report status changes.
 */
export const postExternalLinks = pgTable(
  'post_external_links',
  {
    id: typeIdWithDefault('linked_entity')('id').primaryKey(),
    postId: typeIdColumn('post')('post_id').notNull(),
    integrationId: typeIdColumn('integration')('integration_id').notNull(),
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
    unique('post_external_links_type_external_id').on(table.integrationType, table.externalId),
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
