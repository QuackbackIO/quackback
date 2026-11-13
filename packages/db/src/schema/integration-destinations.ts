/**
 * The destinations one integration connection serves: GitHub repositories
 * today, Linear teams or Jira projects later. The connection (OAuth token,
 * mappings, status-sync switch) stays on `integrations`, one row per provider;
 * everything that differs per repository lives here, including the webhook
 * that repository delivers to and the secret it signs with.
 */
import {
  pgTable,
  text,
  varchar,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { integrations } from './integrations'

/**
 * Per-destination provider settings, merged over the connection's config when
 * provider code runs for this destination. Free to grow per provider: a jsonb
 * column with no CHECK, so this type is the vocabulary.
 */
export interface IntegrationDestinationConfig {
  /** GitHub: whether this repository's issues and comments open inbox conversations. */
  inboundMode?: 'conversations' | 'off'
  [key: string]: unknown
}

export const integrationDestinations = pgTable(
  'integration_destinations',
  {
    id: typeIdWithDefault('integration_destination')('id').primaryKey(),
    integrationId: typeIdColumn('integration')('integration_id').notNull(),
    /** The provider's destination kind, a key of the definition's `destinations` (e.g. `repo`). */
    kind: varchar('kind', { length: 32 }).notNull(),
    /** The provider's name for it, as the API addresses it (`owner/repo`). */
    externalId: text('external_id').notNull(),
    /** The provider's immutable id (GitHub's numeric repository id), which survives a rename. */
    externalKey: text('external_key'),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config')
      .$type<IntegrationDestinationConfig>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Encrypted JSON `{ webhookSecret }`. Never returned to the browser. */
    secrets: text('secrets'),
    externalWebhookId: text('external_webhook_id'),
    /** The events the registered webhook subscribes to, as last written to the provider. */
    webhookEvents: text('webhook_events').array(),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'integration_destinations_integration_id_fkey',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    // Repository names are case-insensitive on GitHub, so `Acme/App` and
    // `acme/app` are one destination.
    uniqueIndex('integration_destinations_external_id_uq').on(
      table.integrationId,
      table.kind,
      sql`lower(${table.externalId})`
    ),
    uniqueIndex('integration_destinations_external_key_uq')
      .on(table.integrationId, table.kind, table.externalKey)
      .where(sql`${table.externalKey} IS NOT NULL`),
    index('integration_destinations_integration_idx').on(table.integrationId),
  ]
)

export const integrationDestinationsRelations = relations(integrationDestinations, ({ one }) => ({
  integration: one(integrations, {
    fields: [integrationDestinations.integrationId],
    references: [integrations.id],
  }),
}))
