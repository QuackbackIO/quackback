/**
 * Database connection for the web app.
 *
 * IMPORTANT: Always import database utilities from '@/lib/db', not '@quackback/db'.
 * This ensures the database connection is properly initialized.
 *
 * @example
 * import { db, eq, and, posts } from '@/lib/db'
 */

import { setDbGetter, createDb, type Database } from '@quackback/db/client'

// Track initialization to avoid duplicate setup in hot reload
let initialized = false

// Use globalThis to persist database instance across hot reloads in development
declare global {
  var __db_instance: Database | undefined
}

/**
 * Initialize the database connection.
 * Uses DATABASE_URL environment variable.
 */
function initializeDb(): void {
  if (initialized) return
  initialized = true

  setDbGetter((): Database => {
    // Return cached instance if available (persists across hot reloads)
    if (globalThis.__db_instance) {
      return globalThis.__db_instance
    }

    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required')
    }

    // Create and cache the database instance
    globalThis.__db_instance = createDb(connectionString, { max: 50 })
    return globalThis.__db_instance
  })
}

// Initialize on module load
initializeDb()

// Re-export everything from the db package
export * from '@quackback/db'

// Re-export client utilities for advanced use cases
export { createDb, setDbGetter, getDb } from '@quackback/db/client'

// Re-export types (for client components that need types without side effects)
export * from '@quackback/db/types'
