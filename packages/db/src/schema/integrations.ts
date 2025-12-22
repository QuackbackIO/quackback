import {
  pgTable,
  uuid,
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

/**
 * Links local entities to external entities for two-way sync tracking.
 * E.g., post ID <-> Slack message ID, post ID <-> Linear issue ID
 */
export const integrationLinkedEntities = pgTable(
  'integration_linked_entities',
  {
    id: typeIdWithDefault('linked_entity')('id').primaryKey(),
    integrationId: typeIdColumn('integration')('integration_id').notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    externalEntityType: varchar('external_entity_type', { length: 50 }).notNull(),
    externalEntityId: varchar('external_entity_id', { length: 255 }).notNull(),
    externalEntityUrl: text('external_entity_url'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'linked_entities_integration_fk',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    unique('linked_entity_unique').on(table.integrationId, table.entityType, table.entityId),
    index('idx_linked_entities_lookup').on(table.integrationId, table.entityType, table.entityId),
  ]
)

/**
 * Audit log for integration sync operations.
 * Used for debugging and monitoring integration health.
 */
export const integrationSyncLog = pgTable(
  'integration_sync_log',
  {
    id: typeIdWithDefault('sync_log')('id').primaryKey(),
    integrationId: typeIdColumn('integration')('integration_id').notNull(),
    eventId: uuid('event_id'),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    actionType: varchar('action_type', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'sync_log_integration_fk',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    index('idx_sync_log_integration_created').on(table.integrationId, table.createdAt),
  ]
)

// Relations
export const integrationsRelations = relations(integrations, ({ one, many }) => ({
  connectedBy: one(member, {
    fields: [integrations.connectedByMemberId],
    references: [member.id],
  }),
  eventMappings: many(integrationEventMappings),
  linkedEntities: many(integrationLinkedEntities),
  syncLogs: many(integrationSyncLog),
}))

export const integrationEventMappingsRelations = relations(integrationEventMappings, ({ one }) => ({
  integration: one(integrations, {
    fields: [integrationEventMappings.integrationId],
    references: [integrations.id],
  }),
}))

export const integrationLinkedEntitiesRelations = relations(
  integrationLinkedEntities,
  ({ one }) => ({
    integration: one(integrations, {
      fields: [integrationLinkedEntities.integrationId],
      references: [integrations.id],
    }),
  })
)

export const integrationSyncLogRelations = relations(integrationSyncLog, ({ one }) => ({
  integration: one(integrations, {
    fields: [integrationSyncLog.integrationId],
    references: [integrations.id],
  }),
}))
