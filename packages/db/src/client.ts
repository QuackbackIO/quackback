import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = PostgresJsDatabase<typeof schema>

export interface CreateDbOptions {
  /** Maximum number of connections (default: 10) */
  max?: number
  /** Disable prepared statements (required for some connection poolers) */
  prepare?: boolean
}

/**
 * Create a Drizzle database client from a connection string.
 * This is a pure factory function with no runtime-specific dependencies.
 */
export function createDb(connectionString: string, options?: CreateDbOptions): Database {
  const sql = postgres(connectionString, {
    max: options?.max ?? 10,
    prepare: options?.prepare ?? true,
  })
  return drizzle(sql, { schema })
}

// Global database instance registry
let _dbGetter: (() => Database) | null = null

/**
 * Configure the global database getter.
 * Call this once at app startup with your runtime-specific db factory.
 *
 * @example
 * // In apps/web/lib/db.ts
 * import { setDbGetter, createDb } from '@quackback/db/client'
 * import { cache } from 'react'
 *
 * setDbGetter(cache(() => {
 *   // Your runtime-specific logic here
 *   return createDb(connectionString, options)
 * }))
 */
export function setDbGetter(getter: () => Database): void {
  _dbGetter = getter
}

/**
 * Get the database instance.
 * Requires setDbGetter() to be called first.
 */
export function getDb(): Database {
  if (!_dbGetter) {
    // Fallback to DATABASE_URL for migrations and scripts
    const connectionString = process.env.DATABASE_URL
    if (connectionString) {
      return createDb(connectionString)
    }
    throw new Error(
      'Database not configured. Call setDbGetter() at app startup, or set DATABASE_URL.'
    )
  }
  return _dbGetter()
}

/**
 * Proxy that lazily accesses the database on each property access.
 * Allows importing `db` at module load time before configuration.
 */
export const db: Database = new Proxy({} as Database, {
  get(_, prop) {
    const database = getDb()
    return (database as unknown as Record<string | symbol, unknown>)[prop]
  },
})

/**
 * Create a database client for migrations.
 * Uses DATABASE_URL directly, only works in Node.js.
 */
export function getMigrationDb(): Database {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required for migrations')
  }
  return createDb(connectionString, { max: 1 })
}
