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
  /**
   * Which way this destination syncs: `outbound` only receives what we send
   * (created issues), `inbound` only reports back (status, comments), `both`
   * (the default when unset) does both.
   */
  direction?: 'both' | 'outbound' | 'inbound'
  /**
   * GitHub: whether this repository's issues and comments open inbox
   * conversations, and with `tickets` a customer ticket paired with each one.
   */
  inboundMode?: 'conversations' | 'tickets' | 'off'
  /** GitHub, `tickets` mode: the team and ticket type a ticket opened from an issue gets. */
  ticketScope?: { teamId?: string | null; ticketTypeId?: string | null }
  /**
   * GitHub issue state (`Open`, `Closed`, `Closed (not planned)`) → ticket
   * status id for this repository, over the connection's own
   * `ticketStatusMappings`. Null ignores that state.
   */
  ticketStatusMappings?: Record<string, string | null>
  /**
   * GitHub: an issue assigned or unassigned on GitHub assigns or unassigns
   * the tickets linked to it, through the connection's account matches
   * (`integration_user_mappings`). Off unless switched on.
   */
  assigneeSync?: boolean
  /**
   * A linked ticket's public replies are posted to its issue in this
   * destination as comments, and those comments follow the reply's edits,
   * files and deletion. Off unless switched on: on a public repository the
   * customer's words become public.
   */
  postRepliesAsComments?: boolean
  /**
   * When `postRepliesAsComments` was last switched on (ISO), set by the
   * server and never by a settings patch: no reply written before it is
   * posted, so switching the option on never publishes what was said before.
   */
  postRepliesAsCommentsSince?: string
  /**
   * What a comment on an issue linked to a ticket becomes on that ticket:
   * nothing (`off`, the default), an internal note the team sees (`note`), or
   * a public reply the requester sees and is notified of (`reply`).
   */
  commentVisibility?: 'off' | 'note' | 'reply'
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
