import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = PostgresJsDatabase<typeof schema>

export interface CreateDbOptions {
  /** Maximum number of connections (default: 10) */
  max?: number
  /** Disable prepared statements (required for some connection poolers) */
  prepare?: boolean
  /** Close idle connections after this many seconds (default: 20). */
  idleTimeout?: number
}

/**
 * Create a Drizzle database client from a connection string.
 * This is a pure factory function with no runtime-specific dependencies.
 */
export function createDb(connectionString: string, options?: CreateDbOptions): Database {
  const sql = postgres(connectionString, {
    max: options?.max ?? 10,
    prepare: options?.prepare ?? true,
    idle_timeout: options?.idleTimeout ?? 20,
  })
  return drizzle(sql, { schema })
}

/**
 * Wrap an existing postgres.js handle.
 *
 * A pooled multi-tenant process cannot use {@link createDb}: a tenant pool needs
 * options a connection string cannot carry — chiefly a `password` *function*, so
 * a rotated credential is picked up on the next connection rather than wedging
 * the pool. Building the handle at the call site and wrapping it here keeps the
 * schema wiring in one place, which is the part that must not be duplicated.
 */
export function createDbFromSql(sql: postgres.Sql): Database {
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
