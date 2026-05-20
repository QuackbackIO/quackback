import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import path from 'path'
import { fileURLToPath } from 'url'
import { postStatuses, DEFAULT_STATUSES } from './schema/statuses'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  // Allow overriding migrations folder via env var (for Docker)
  // Default to ./drizzle relative to this script
  const migrationsFolder = process.env.MIGRATIONS_FOLDER || path.resolve(__dirname, '../drizzle')

  console.log('🔄 Running migrations...')
  console.log(`   Migrations folder: ${migrationsFolder}`)

  // Use a single connection for migrations
  const sql = postgres(connectionString, { max: 1 })
  const db = drizzle(sql)

  try {
    // Ensure pgvector extension is available before running migrations
    await sql`CREATE EXTENSION IF NOT EXISTS vector`
    await migrate(db, { migrationsFolder })
    console.log('✅ Migrations completed successfully!')

    // Seed default post statuses if none exist. Cloud-provisioned tenants
    // boot empty: the post.service requires an `open` default status to
    // create posts, and without it the very first post submission throws
    // "Default 'open' status not found." Idempotent — re-running on a
    // pod with statuses already configured is a no-op.
    const existing = await db.select({ id: postStatuses.id }).from(postStatuses).limit(1)
    if (existing.length === 0) {
      await db.insert(postStatuses).values(DEFAULT_STATUSES)
      console.log(`✅ Seeded ${DEFAULT_STATUSES.length} default post statuses`)
    }
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

runMigrations()
