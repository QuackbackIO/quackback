import { pgTable, text, timestamp, varchar, index, unique, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { integrations } from './integrations'
import { principal } from './auth'

/**
 * Maps external platform usernames to workspace principals.
 * Used for bidirectional assignee sync (e.g. GitHub username → team member).
 * Populated via collaborator list fetch or manual mapping in settings UI.
 */
export const integrationUserMappings = pgTable(
  'integration_user_mappings',
  {
    id: typeIdWithDefault('user_mapping')('id').primaryKey(),
    integrationId: typeIdColumn('integration')('integration_id').notNull(),
    externalUsername: varchar('external_username', { length: 255 }).notNull(),
    externalDisplayName: text('external_display_name'),
    principalId: typeIdColumnNullable('principal')('principal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'integration_user_mappings_integration_fk',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'integration_user_mappings_principal_fk',
      columns: [table.principalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    unique('integration_user_mappings_integration_username_unique').on(
      table.integrationId,
      table.externalUsername
    ),
    index('integration_user_mappings_principal_idx').on(table.principalId),
  ]
)

// Relations
export const integrationUserMappingsRelations = relations(integrationUserMappings, ({ one }) => ({
  integration: one(integrations, {
    fields: [integrationUserMappings.integrationId],
    references: [integrations.id],
  }),
  principal: one(principal, {
    fields: [integrationUserMappings.principalId],
    references: [principal.id],
  }),
}))
