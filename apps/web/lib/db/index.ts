/**
 * Database barrel file for the web app.
 *
 * IMPORTANT: Always import database utilities from '@/lib/db', never from '@quackback/db'.
 * This ensures the database connection is properly initialized.
 *
 * @example
 * import { db, eq, and, posts } from '@/lib/db'
 */

import { setDbGetter, createDb } from '@quackback/db/client'
import { cache } from 'react'

/**
 * Get database connection, memoized per-request via React cache().
 */
const getDatabase = cache(() => createDb(process.env.DATABASE_URL!))

// Configure the global database getter
setDbGetter(getDatabase)

// Re-export everything from the db package
export * from '@quackback/db'

// Re-export types
export * from '@quackback/db/types'

// Re-export query helpers
export * from '@quackback/db/queries/subscriptions'
export * from '@quackback/db/queries/usage'

// Export initialization utilities for advanced use cases
export { getDatabase }
export { createDb, setDbGetter, getDb } from '@quackback/db/client'
