/**
 * API Keys schema for public API authentication
 *
 * API keys are created by admins and used by external integrations
 * to authenticate with the public REST API.
 */
import { pgTable, timestamp, varchar, index, text, boolean } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

/**
 * API Keys table
 *
 * Stores hashed API keys for authentication.
 * The actual key is only shown once on creation.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: typeIdWithDefault('api_key')('id').primaryKey(),
    /** Human-readable name for the key */
    name: varchar('name', { length: 255 }).notNull(),
    /** SHA-256 hash of the API key (64 hex chars) */
    keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
    /** First 12 characters of the key for identification (e.g., "qb_a1b2c3d4") */
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    /** Principal who created this key (nullable — key survives if creator leaves) */
    createdById: typeIdColumnNullable('principal')('created_by_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    /** Service principal representing this API key's identity */
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    /** Last time the key was used for authentication */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Optional expiration date */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** When the key was created */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** When the key was revoked (soft delete) */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Allowed permission scopes (dotted permission keys, e.g. ['ticket.view_all']).
     * Empty array + compatLegacyFullAccess=true means "all permissions" (legacy).
     */
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Allowed team IDs; empty array means "any team allowed by scopes". */
    allowedTeamIds: text('allowed_team_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Allowed inbox IDs; empty array means "any inbox allowed by scopes". */
    allowedInboxIds: text('allowed_inbox_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Last client IP that authenticated with this key. */
    lastIp: text('last_ip'),
    /** Last user-agent (truncated to 500 chars). */
    lastUserAgent: text('last_user_agent'),
    /** When the key was last rotated. */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    /**
     * If true, an empty `scopes` array grants all permissions (legacy behavior).
     * Cleared automatically the first time `scopes` becomes non-empty.
     */
    compatLegacyFullAccess: boolean('compat_legacy_full_access').notNull().default(true),
    /** When an admin acknowledged the legacy compat warning for this key. */
    compatAcknowledgedAt: timestamp('compat_acknowledged_at', { withTimezone: true }),
  },
  (table) => [
    // Index for listing keys by creator
    index('api_keys_created_by_id_idx').on(table.createdById),
    // Index for looking up the key's service principal
    index('api_keys_principal_id_idx').on(table.principalId),
    // Index for filtering active/revoked keys
    index('api_keys_revoked_at_idx').on(table.revokedAt),
    // GIN indexes for array containment lookups
    index('api_keys_scopes_idx').using('gin', table.scopes),
    index('api_keys_allowed_team_ids_idx').using('gin', table.allowedTeamIds),
    index('api_keys_allowed_inbox_ids_idx').using('gin', table.allowedInboxIds),
  ]
)

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  createdBy: one(principal, {
    fields: [apiKeys.createdById],
    references: [principal.id],
    relationName: 'apiKeyCreator',
  }),
  principal: one(principal, {
    fields: [apiKeys.principalId],
    references: [principal.id],
    relationName: 'apiKeyPrincipal',
  }),
}))
