import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  boolean,
  integer,
  varchar,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { member } from './auth'

/**
 * Integration configurations.
 * Stores OAuth tokens (encrypted), connection status, and integration-specific config.
 */
export const integrations = pgTable(
  'integrations',
  {
    id: typeIdWithDefault('integration')('id').primaryKey(),
    integrationType: varchar('integration_type', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),

    // OAuth tokens (encrypted with AES-256-GCM)
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),

    // Configuration (channel IDs, team IDs, etc.)
    config: jsonb('config').notNull().default({}),

    // External workspace info (for Slack team, GitHub org, etc.)
    externalWorkspaceId: varchar('external_workspace_id', { length: 255 }),
    externalWorkspaceName: varchar('external_workspace_name', { length: 255 }),

    // Metadata
    connectedByMemberId: typeIdColumnNullable('member')('connected_by_member_id').references(
      () => member.id
    ),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    errorCount: integer('error_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('integration_type_unique').on(table.integrationType),
    index('idx_integrations_type_status').on(table.integrationType, table.status),
    // CHECK constraint to ensure error count is never negative
    check('error_count_non_negative', sql`error_count >= 0`),
  ]
)

/**
 * Event-to-action mappings for integrations.
 * Defines what actions trigger when specific domain events occur.
 */
export const integrationEventMappings = pgTable(
  'integration_event_mappings',
  {
    id: typeIdWithDefault('event_mapping')('id').primaryKey(),
    integrationId: typeIdColumn('integration')('integration_id').notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    actionType: varchar('action_type', { length: 50 }).notNull(),
    actionConfig: jsonb('action_config').notNull().default({}),
    filters: jsonb('filters'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'event_mappings_integration_fk',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    unique('mapping_unique').on(table.integrationId, table.eventType, table.actionType),
    index('idx_event_mappings_lookup').on(table.integrationId, table.eventType, table.enabled),
  ]
)

// Relations
export const integrationsRelations = relations(integrations, ({ one, many }) => ({
  connectedBy: one(member, {
    fields: [integrations.connectedByMemberId],
    references: [member.id],
  }),
  eventMappings: many(integrationEventMappings),
}))

export const integrationEventMappingsRelations = relations(integrationEventMappings, ({ one }) => ({
  integration: one(integrations, {
    fields: [integrationEventMappings.integrationId],
    references: [integrations.id],
  }),
}))
