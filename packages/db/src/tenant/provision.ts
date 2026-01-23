/**
 * Tenant Database Provisioning
 *
 * Applies all migrations to a new tenant database and records them in the
 * drizzle migrations table for future `db:migrate:cloud` compatibility.
 */

import {
  MIGRATIONS,
  SCHEMA_VERSION,
  parseStatements,
  CREATE_MIGRATIONS_TABLE_SQL,
  INSERT_MIGRATION_SQL,
  GET_APPLIED_MIGRATIONS_SQL,
} from '../init-sql.generated'

export type { Migration } from '../init-sql.generated'
export { MIGRATIONS, SCHEMA_VERSION, parseStatements, SEED_SQL } from '../init-sql.generated'

export interface SqlExecutor {
  (query: string, params?: unknown[]): Promise<unknown>
}

export interface ProvisionResult {
  success: boolean
  migrationsApplied: number
  schemaVersion: string
  error?: string
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

async function getAppliedHashes(sql: SqlExecutor): Promise<Set<string>> {
  const applied = (await sql(GET_APPLIED_MIGRATIONS_SQL)) as { hash: string }[]
  return new Set(applied.map((r) => r.hash))
}

/**
 * Apply all migrations to a new tenant database.
 */
export async function provisionTenantDatabase(sql: SqlExecutor): Promise<ProvisionResult> {
  try {
    for (const stmt of splitStatements(CREATE_MIGRATIONS_TABLE_SQL)) {
      await sql(stmt)
    }

    const appliedHashes = await getAppliedHashes(sql)
    let migrationsApplied = 0

    for (const migration of MIGRATIONS) {
      if (appliedHashes.has(migration.hash)) continue

      for (const stmt of parseStatements(migration.sql)) {
        await sql(stmt)
      }

      await sql(INSERT_MIGRATION_SQL, [migration.hash, migration.when])
      migrationsApplied++
    }

    return {
      success: true,
      migrationsApplied,
      schemaVersion: SCHEMA_VERSION,
    }
  } catch (error) {
    return {
      success: false,
      migrationsApplied: 0,
      schemaVersion: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
