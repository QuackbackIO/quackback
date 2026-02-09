/**
 * API Keys schema for public API authentication
 *
 * API keys are created by admins and used by external integrations
 * to authenticate with the public REST API.
 */
import { pgTable, timestamp, varchar, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
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
    /** Principal who created this key */
    createdById: typeIdColumn('principal')('created_by_id')
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
  },
  (table) => [
    // Index for listing keys by creator
    index('api_keys_created_by_id_idx').on(table.createdById),
    // Index for filtering active/revoked keys
    index('api_keys_revoked_at_idx').on(table.revokedAt),
  ]
)

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  createdBy: one(principal, {
    fields: [apiKeys.createdById],
    references: [principal.id],
  }),
}))
