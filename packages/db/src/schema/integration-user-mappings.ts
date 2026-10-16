/**
 * Accounts on a provider matched to teammates: a GitHub user is the same
 * teammate in every repository one connection serves, so a mapping belongs to
 * the connection, not to a repository. Inbound assignee sync reads it to turn
 * an issue's assignee into the ticket's assignee.
 *
 * Teammates only. `channel_identities` resolves the customers who write in
 * through a channel; a teammate recorded there would have their own GitHub
 * issues attributed to them as the visitor.
 */
import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { integrations } from './integrations'
import { principal } from './auth'

export const integrationUserMappings = pgTable(
  'integration_user_mappings',
  {
    id: typeIdWithDefault('integration_user_mapping')('id').primaryKey(),
    integrationId: typeIdColumn('integration')('integration_id').notNull(),
    /** The provider's immutable user id (GitHub's numeric id), which survives a rename. */
    externalUserId: text('external_user_id').notNull(),
    /** The provider's login as last seen; refreshed when a delivery shows a new one. */
    externalLogin: text('external_login').notNull(),
    externalDisplayName: text('external_display_name'),
    /** The teammate (admin or member) the account stands for. */
    principalId: typeIdColumn('principal')('principal_id').notNull(),
    createdByPrincipalId: typeIdColumnNullable('principal')('created_by_principal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'integration_user_mappings_integration_id_fkey',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'integration_user_mappings_principal_id_fkey',
      columns: [table.principalId],
      foreignColumns: [principal.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'integration_user_mappings_created_by_principal_id_fkey',
      columns: [table.createdByPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    // One teammate per account, and one account per teammate.
    uniqueIndex('integration_user_mappings_external_user_uq').on(
      table.integrationId,
      table.externalUserId
    ),
    uniqueIndex('integration_user_mappings_principal_uq').on(
      table.integrationId,
      table.principalId
    ),
    // Logins are case-insensitive on GitHub; the fallback lookup goes by login.
    index('integration_user_mappings_login_idx').on(
      table.integrationId,
      sql`lower(${table.externalLogin})`
    ),
  ]
)

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
