/**
 * Node.js database adapter
 *
 * Uses DATABASE_URL environment variable for PostgreSQL connection.
 * This is the default adapter for self-hosted (OSS) deployments.
 */

import { cache } from 'react'
import { createDb, type Database } from '@quackback/db/client'

/**
 * Get database connection via DATABASE_URL, memoized per-request.
 */
export const getNodeDb = cache((): Database => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required')
  }
  return createDb(connectionString)
})
