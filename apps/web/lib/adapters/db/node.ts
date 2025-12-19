/**
 * Node.js database adapter
 *
 * Uses DATABASE_URL environment variable for PostgreSQL connection.
 * This is the default adapter for self-hosted (OSS) deployments.
 */

import { createDb, type Database } from '@quackback/db/client'

// Reuse the global instance from the main adapter
declare global {
  var __db_instance: Database | undefined
}

/**
 * Get database connection via DATABASE_URL.
 * Uses cached globalThis instance to prevent connection exhaustion in dev mode.
 */
export function getNodeDb(): Database {
  // Return cached instance if available
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
}
