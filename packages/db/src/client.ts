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
