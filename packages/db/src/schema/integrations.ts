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
import { principal } from './auth'
import { postExternalLinks } from './external-links'
import type { IntegrationConfig, EventMappingActionConfig, EventMappingFilters } from '../types'

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

    // Encrypted secrets blob (JSON, AES-256-GCM)
    // Contains integration-specific secrets (e.g., { accessToken: "xoxb-..." } for Slack)
    secrets: text('secrets'),

    // Configuration (channel IDs, team IDs, etc.)
    config: jsonb('config').$type<IntegrationConfig>().notNull().default({}),

    // Metadata
    connectedByPrincipalId: typeIdColumnNullable('principal')(
      'connected_by_principal_id'
    ).references(() => principal.id),
    /** Service principal representing this integration's identity */
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    errorCount: integer('error_count').notNull().default(0),

    // Health telemetry (WO-14) — feeds the settings-page health panel, since
    // hook_deliveries carries no integration attribution. (Error state reuses
    // the existing lastError/lastErrorAt columns above.)
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('integration_type_unique').on(table.integrationType),
    // CHECK constraint to ensure error count is never negative
    check('error_count_non_negative', sql`error_count >= 0`),
  ]
)

/**
 * Platform-level credentials for integrations (OAuth app credentials).
 * One row per provider. Secrets are AES-256-GCM encrypted.
 * Presence of a row = configured; no row = not configured.
 */
export const integrationPlatformCredentials = pgTable(
  'integration_platform_credentials',
  {
    id: typeIdWithDefault('platform_cred')('id').primaryKey(),
    integrationType: varchar('integration_type', { length: 50 }).notNull(),
    secrets: text('secrets').notNull(),
    configuredByPrincipalId: typeIdColumnNullable('principal')('configured_by_principal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Named to match the migration's constraint (63-char pg truncation).
    foreignKey({
      name: 'integration_platform_credentials_configured_by_principal_id_pri',
      columns: [table.configuredByPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    unique('platform_cred_type_unique').on(table.integrationType),
  ]
)

export const integrationPlatformCredentialsRelations = relations(
  integrationPlatformCredentials,
  ({ one }) => ({
    configuredBy: one(principal, {
      fields: [integrationPlatformCredentials.configuredByPrincipalId],
      references: [principal.id],
    }),
  })
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
    actionConfig: jsonb('action_config').$type<EventMappingActionConfig>().notNull().default({}),
    filters: jsonb('filters').$type<EventMappingFilters>(),
    /** Discriminator for multiple mappings of the same event+action (e.g. per-board targets) */
    targetKey: varchar('target_key', { length: 100 }).notNull().default('default'),
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
    // Columns listed alphabetically: drizzle-kit introspects multi-column
    // UNIQUE constraints in alphabetical order, and the drift check compares
    // that order. The live constraint's real order comes from the migration.
    unique('mapping_unique').on(
      table.actionType,
      table.eventType,
      table.integrationId,
      table.targetKey
    ),
    index('idx_event_mappings_lookup').on(table.integrationId, table.eventType, table.enabled),
  ]
)

// Relations
export const integrationsRelations = relations(integrations, ({ one, many }) => ({
  connectedBy: one(principal, {
    fields: [integrations.connectedByPrincipalId],
    references: [principal.id],
    relationName: 'integrationConnector',
  }),
  principal: one(principal, {
    fields: [integrations.principalId],
    references: [principal.id],
    relationName: 'integrationPrincipal',
  }),
  eventMappings: many(integrationEventMappings),
  externalLinks: many(postExternalLinks),
}))

export const integrationEventMappingsRelations = relations(integrationEventMappings, ({ one }) => ({
  integration: one(integrations, {
    fields: [integrationEventMappings.integrationId],
    references: [integrations.id],
  }),
}))
