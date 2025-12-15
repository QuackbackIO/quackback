/**
 * Drizzle ORM custom column types for TypeID
 *
 * These column types store UUIDs in the database (16 bytes, optimal indexing)
 * while exposing TypeID strings to the application layer.
 *
 * Benefits:
 * - Optimal database storage (native UUID type)
 * - Type-safe branded types in TypeScript
 * - Automatic conversion at ORM boundary
 * - UUIDv7 for time-ordered IDs (better index performance)
 */

import { customType, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { generateId, fromUuid, toUuid } from './core'
import type { IdPrefix } from './prefixes'
import type { TypeId } from './types'

/**
 * Custom Drizzle column type for TypeID
 *
 * Stores as native UUID in PostgreSQL (16 bytes),
 * converts to/from TypeID at the application layer.
 *
 * @param prefix - The entity type prefix
 * @returns A custom column builder
 *
 * @example
 * export const posts = pgTable('posts', {
 *   id: typeIdColumn('post')('id').primaryKey(),
 *   boardId: typeIdColumn('board')('board_id').notNull(),
 * })
 */
export function typeIdColumn<P extends IdPrefix>(prefix: P) {
  return customType<{
    data: TypeId<P>
    driverData: string
  }>({
    dataType() {
      return 'uuid'
    },
    toDriver(value: TypeId<P>): string {
      // Convert TypeID to UUID for database storage
      return toUuid(value)
    },
    fromDriver(value: unknown): TypeId<P> {
      // Convert UUID from database to TypeID
      if (typeof value !== 'string') {
        throw new Error(`Expected string from database, got ${typeof value}`)
      }
      return fromUuid(prefix, value)
    },
  })
}

/**
 * TypeID column with nullable support
 *
 * For nullable foreign keys that reference TypeID columns.
 *
 * @param prefix - The entity type prefix
 * @returns A custom column builder that handles null
 *
 * @example
 * export const unsubscribeTokens = pgTable('unsubscribe_tokens', {
 *   postId: typeIdColumnNullable('post')('post_id').references(() => posts.id),
 * })
 */
export function typeIdColumnNullable<P extends IdPrefix>(prefix: P) {
  return customType<{
    data: TypeId<P> | null
    driverData: string | null
  }>({
    dataType() {
      return 'uuid'
    },
    toDriver(value: TypeId<P> | null): string | null {
      if (value === null) return null
      return toUuid(value)
    },
    fromDriver(value: unknown): TypeId<P> | null {
      if (value === null || value === undefined) return null
      if (typeof value !== 'string') {
        throw new Error(`Expected string from database, got ${typeof value}`)
      }
      return fromUuid(prefix, value)
    },
  })
}

/**
 * TypeID column with automatic UUIDv7 generation
 *
 * Generates a new UUIDv7-based TypeID when inserting without explicit ID.
 *
 * @param prefix - The entity type prefix
 * @returns A custom column builder with default generation
 *
 * @example
 * export const posts = pgTable('posts', {
 *   id: typeIdWithDefault('post')('id').primaryKey(),
 *   // When inserting: { title: 'New Post' }
 *   // ID is auto-generated: 'post_01h455vb4pex5vsknk084sn02q'
 * })
 */
export function typeIdWithDefault<P extends IdPrefix>(prefix: P) {
  return (columnName: string) =>
    typeIdColumn(prefix)(columnName).$defaultFn(() => generateId(prefix))
}

/**
 * Standard UUID column that accepts TypeID input
 *
 * Useful for columns that store UUID but receive TypeID from API.
 * Does not convert on read (returns raw UUID).
 *
 * @param prefix - The expected prefix for input validation
 * @returns A custom column builder
 *
 * @example
 * // For foreign keys where you want to accept TypeID input
 * // but don't need TypeID output
 * export const posts = pgTable('posts', {
 *   boardId: uuidFromTypeId('board')('board_id'),
 * })
 */
export function uuidFromTypeId<P extends IdPrefix>(_prefix: P) {
  return customType<{
    data: string // Raw UUID
    driverData: string
  }>({
    dataType() {
      return 'uuid'
    },
    toDriver(value: string): string {
      // If it's a TypeID, convert to UUID
      if (value.includes('_')) {
        return toUuid(value)
      }
      // Already a UUID
      return value
    },
    fromDriver(value: unknown): string {
      // Return raw UUID from database
      return value as string
    },
  })
}

/**
 * Helper to create a UUID column with gen_random_uuid() default
 *
 * For cases where you want database-generated UUIDs
 * (not UUIDv7, but compatible with TypeID conversion at read time)
 *
 * @deprecated Prefer typeIdWithDefault for new columns
 */
export function uuidWithDatabaseDefault() {
  return uuid().default(sql`gen_random_uuid()`)
}

/**
 * Create a reference column that accepts TypeID for a foreign key
 *
 * This is a convenience function for defining foreign key columns
 * that accept TypeID input but store as UUID.
 *
 * @param prefix - The expected prefix for the referenced entity
 * @returns A column builder for foreign key usage
 *
 * @example
 * export const posts = pgTable('posts', {
 *   boardId: typeIdReference('board')('board_id')
 *     .notNull()
 *     .references(() => boards.id),
 * })
 */
export function typeIdReference<P extends IdPrefix>(prefix: P) {
  return typeIdColumn(prefix)
}

/**
 * Custom Drizzle column type for Better-auth text IDs
 *
 * Better-auth uses text IDs (nanoid format) for user, member, organization, etc.
 * This column stores the raw text ID in PostgreSQL but exposes it with a TypeID
 * prefix in the application layer for consistency.
 *
 * @param prefix - The entity type prefix (e.g., 'member', 'user', 'org')
 * @returns A custom column builder
 *
 * @example
 * export const posts = pgTable('posts', {
 *   // References Better-auth's member.id (text)
 *   memberId: textIdColumn('member')('member_id').references(() => member.id),
 * })
 * // DB stores: "abc123xyz"
 * // App sees: "member_abc123xyz"
 */
export function textIdColumn<P extends IdPrefix>(prefix: P) {
  return customType<{
    data: TypeId<P>
    driverData: string
  }>({
    dataType() {
      return 'text'
    },
    toDriver(value: TypeId<P>): string {
      // Strip prefix: "member_abc123" → "abc123"
      const idx = value.indexOf('_')
      return idx >= 0 ? value.slice(idx + 1) : value
    },
    fromDriver(value: unknown): TypeId<P> {
      // Add prefix: "abc123" → "member_abc123"
      return `${prefix}_${value}` as TypeId<P>
    },
  })
}

/**
 * Text ID column with optional (nullable) support
 *
 * Convenience wrapper for nullable Better-auth ID references.
 *
 * @param prefix - The entity type prefix
 * @returns A nullable text ID column builder
 */
export function textIdColumnNullable<P extends IdPrefix>(prefix: P) {
  return customType<{
    data: TypeId<P> | null
    driverData: string | null
  }>({
    dataType() {
      return 'text'
    },
    toDriver(value: TypeId<P> | null): string | null {
      if (value === null) return null
      const idx = value.indexOf('_')
      return idx >= 0 ? value.slice(idx + 1) : value
    },
    fromDriver(value: unknown): TypeId<P> | null {
      if (value === null || value === undefined) return null
      return `${prefix}_${value}` as TypeId<P>
    },
  })
}

// ============================================
// Migration Helpers
// ============================================

/**
 * SQL helper to convert UUID to TypeID format in queries
 *
 * @param prefix - The prefix to use
 * @param uuidColumn - The UUID column expression
 * @returns SQL expression for TypeID string
 *
 * @example
 * // In a raw query
 * sql`SELECT ${toTypeIdSql('post', posts.id)} as id FROM posts`
 */
export function toTypeIdSql(prefix: string, uuidColumn: unknown) {
  // Note: This creates a SQL expression that concatenates prefix with base32 UUID
  // For actual TypeID format, you'd need a PostgreSQL function
  // This is a simplified version that just prefixes the UUID
  return sql`${prefix} || '_' || replace(${uuidColumn}::text, '-', '')`
}

/**
 * Type helper to infer TypeId type from a column definition
 */
export type InferTypeId<T> = T extends { data: infer D } ? D : never
