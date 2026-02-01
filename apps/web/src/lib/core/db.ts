/**
 * Core database connection for the web app.
 *
 * This module contains the actual database initialization and connection logic.
 * For most imports, use '@/lib/db' which re-exports everything from here.
 *
 * @example
 * import { db, eq, and, posts } from '@/lib/db'
 */

import { createDb, type Database as PostgresDatabase } from '@quackback/db/client'
import { tenantStorage, type Database as NeonDatabase } from '@/lib/tenant'

// Import drizzle-orm operators explicitly to work around Nitro bundler issues
// with nested barrel exports. If we use `export { asc } from 'drizzle-orm'`,
// the bundler may create export objects that reference `asc` without importing it.
import {
  eq as _eq,
  and as _and,
  or as _or,
  ne as _ne,
  gt as _gt,
  gte as _gte,
  lt as _lt,
  lte as _lte,
  like as _like,
  ilike as _ilike,
  inArray as _inArray,
  notInArray as _notInArray,
  isNull as _isNull,
  isNotNull as _isNotNull,
  sql as _sql,
  desc as _desc,
  asc as _asc,
  count as _count,
  sum as _sum,
  avg as _avg,
  min as _min,
  max as _max,
} from 'drizzle-orm'

// Re-export with original names
export const eq = _eq
export const and = _and
export const or = _or
export const ne = _ne
export const gt = _gt
export const gte = _gte
export const lt = _lt
export const lte = _lte
export const like = _like
export const ilike = _ilike
export const inArray = _inArray
export const notInArray = _notInArray
export const isNull = _isNull
export const isNotNull = _isNotNull
export const sql = _sql
export const desc = _desc
export const asc = _asc
export const count = _count
export const sum = _sum
export const avg = _avg
export const min = _min
export const max = _max

// Database can be either postgres.js (self-hosted) or neon-http (cloud)
export type Database = PostgresDatabase | NeonDatabase
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

// Use globalThis to persist database instance across hot reloads in development
declare global {
  var __db: PostgresDatabase | undefined
}

/**
 * Get the database instance.
 *
 * For self-hosted deployments: Returns a singleton using DATABASE_URL.
 * For cloud multi-tenant: Returns tenant DB from AsyncLocalStorage context.
 */
function getDatabase(): Database {
  // Cloud multi-tenant mode: get tenant database from request context
  if (process.env.CLOUD_CATALOG_DATABASE_URL) {
    const ctx = tenantStorage.getStore()
    if (ctx?.db) {
      return ctx.db
    }
    // No tenant context in cloud mode - this is an error
    // Requests must go through server.ts which sets up tenant context
    throw new Error(
      'No tenant context available. In cloud mode, all database access must occur within a request that has been resolved to a tenant.'
    )
  }

  // Self-hosted singleton mode
  if (!globalThis.__db) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required')
    }
    globalThis.__db = createDb(connectionString, { max: 50 })
  }
  return globalThis.__db
}

/**
 * Database instance.
 * Uses a Proxy to lazily resolve the database on first access.
 */
export const db: Database = new Proxy({} as Database, {
  get(_, prop) {
    const database = getDatabase()
    return (database as unknown as Record<string | symbol, unknown>)[prop]
  },
})

// Re-export everything from the db package
// Note: We explicitly import and re-export drizzle-orm operators here
// because Nitro's bundler has issues with nested barrel exports (export *)
// that can cause "X is not defined" errors at runtime.
export {
  // Schema tables - auth
  account,
  accountRelations,
  invitation,
  invitationRelations,
  member,
  memberRelations,
  oneTimeToken,
  session,
  sessionRelations,
  settings,
  settingsRelations,
  user,
  userRelations,
  verification,
  // Schema tables - boards
  boards,
  boardsRelations,
  roadmaps,
  roadmapsRelations,
  tags,
  tagsRelations,
  // Schema tables - statuses
  DEFAULT_STATUSES,
  postStatuses,
  postStatusesRelations,
  STATUS_CATEGORIES,
  // Schema tables - posts
  commentEditHistory,
  commentEditHistoryRelations,
  commentReactions,
  commentReactionsRelations,
  comments,
  commentsRelations,
  postEditHistory,
  postEditHistoryRelations,
  postNotes,
  postNotesRelations,
  postRoadmaps,
  postRoadmapsRelations,
  posts,
  postsRelations,
  postTags,
  postTagsRelations,
  votes,
  votesRelations,
  // Schema tables - integrations
  integrationEventMappings,
  integrationEventMappingsRelations,
  integrations,
  integrationsRelations,
  // Schema tables - changelog
  changelogEntries,
  changelogEntriesRelations,
  // Schema tables - notifications
  inAppNotifications,
  inAppNotificationsRelations,
  notificationPreferences,
  notificationPreferencesRelations,
  postSubscriptions,
  postSubscriptionsRelations,
  unsubscribeTokens,
  unsubscribeTokensRelations,
  // Schema tables - sentiment
  postSentiment,
  postSentimentRelations,
  // Schema tables - api keys
  apiKeys,
  apiKeysRelations,
  // Schema tables - webhooks
  webhooks,
  webhooksRelations,
  // Types/constants
  REACTION_EMOJIS,
  USE_CASE_TYPES,
  // Client functions
  createDb,
  getMigrationDb,
  // Crypto
  encryptToken,
  decryptToken,
} from '@quackback/db'

// Re-export types (for client components that need types without side effects)
export * from '@quackback/db/types'
