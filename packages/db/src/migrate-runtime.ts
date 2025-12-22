/**
 * Runtime migration function for use in API routes.
 *
 * This is separate from migrate.ts which is a CLI script.
 * This module can be imported and called programmatically.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import path from 'path'
import { fileURLToPath } from 'url'

// Get the directory of this file to resolve the migrations folder
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Migrations folder is at packages/db/drizzle relative to this file
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../drizzle')

/**
 * Run database migrations programmatically.
 *
 * @param connectionString - Optional connection string. Defaults to DATABASE_URL env var.
 * @returns Promise that resolves when migrations are complete.
 */
export async function runMigrations(connectionString?: string): Promise<void> {
  const connStr = connectionString || process.env.DATABASE_URL

  if (!connStr) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  // Use a single connection for migrations
  const sql = postgres(connStr, { max: 1 })
  const database = drizzle(sql)

  try {
    await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await sql.end()
  }
}
