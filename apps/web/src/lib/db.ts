/**
 * Database connection for the web app.
 *
 * IMPORTANT: Always import database utilities from '@/lib/db', not '@quackback/db'.
 * This ensures the database connection is properly initialized.
 *
 * @example
 * import { db, eq, and, posts } from '@/lib/db'
 */

import { createDb, type Database } from '@quackback/db/client'
import { tenantStorage } from '@/lib/tenant'

// Use globalThis to persist database instance across hot reloads in development
declare global {
  var __db: Database | undefined
}

/**
 * Get the database instance.
 *
 * For self-hosted deployments: Returns a singleton using DATABASE_URL.
 * For cloud multi-tenant: Returns tenant DB from AsyncLocalStorage context.
 */
function getDatabase(): Database {
  // Cloud multi-tenant mode: get tenant database from request context
  if (process.env.CATALOG_DATABASE_URL) {
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
export * from '@quackback/db'

// Re-export types (for client components that need types without side effects)
export * from '@quackback/db/types'
