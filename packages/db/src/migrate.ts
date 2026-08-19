import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import path from 'path'
import { fileURLToPath } from 'url'
import * as schema from './schema'
import { seedSystemData } from './seed-system'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Arbitrary application-chosen key identifying "quackback migrations" for
// Postgres advisory locks. Any int8-range value works as long as it's stable
// across processes; this one is just a readable literal, not derived from
// anything. Cast explicitly to bigint below since it exceeds Postgres' int4
// range and postgres-js has no bigint parameter type.
const MIGRATION_LOCK_KEY = 4_820_231_099

async function ensureConcurrentIndexes(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`
  const statements = [
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_embedding_hnsw_idx ON posts USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS kb_articles_embedding_hnsw_idx ON kb_articles USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS assistant_snippets_embedding_hnsw_idx ON assistant_snippets USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_summaries_embedding_hnsw_idx ON conversation_summaries USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS principal_display_name_trgm_idx ON principal USING gin (display_name gin_trgm_ops) WHERE display_name IS NOT NULL',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_messages_content_trgm_idx ON conversation_messages USING gin (content gin_trgm_ops) WHERE deleted_at IS NULL',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS user_name_trgm_idx ON "user" USING gin (name gin_trgm_ops)',
  ]
  for (const statement of statements) await sql.unsafe(statement)

  // page_views is range-partitioned (see 0137), and Postgres rejects
  // CREATE INDEX CONCURRENTLY on a partitioned parent ("cannot create index on
  // partitioned table ... concurrently"). Build it non-concurrently on the
  // parent, matching how 0137 creates the table's other parent indexes; the
  // index recurses to existing partitions. IF NOT EXISTS keeps re-runs a no-op.
  await sql.unsafe(
    'CREATE INDEX IF NOT EXISTS page_views_principal_id_idx ON page_views (principal_id) WHERE principal_id IS NOT NULL'
  )
}

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
  const db = drizzle(sql, { schema })

  try {
    // Serialize concurrent replicas racing to migrate on startup: the first
    // container to grab the lock runs the extension/migrate/seed steps,
    // every other container blocks here until it releases, then finds the
    // drizzle ledger already up to date and the seed already applied (both
    // are idempotent), so it does nothing.
    console.log('🔒 Waiting for migration lock...')
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`
    console.log('🔓 Acquired migration lock')

    // Ensure pgvector extension is available before running migrations
    await sql`CREATE EXTENSION IF NOT EXISTS vector`
    await migrate(db, { migrationsFolder })
    // Drizzle executes migration files transactionally; large production
    // indexes need their own non-transactional concurrent path.
    await ensureConcurrentIndexes(sql)
    console.log('✅ Migrations completed successfully!')

    // Seed the reference data every workspace needs (post statuses, the RBAC
    // permission catalogue, the system-role presets and their bundles).
    // Cloud-provisioned tenants boot empty; idempotent, so re-running on a
    // pod that is already seeded is a no-op.
    await seedSystemData(db)
    console.log('✅ Seeded system data (statuses, roles, permissions)')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    // Session-level advisory locks are also released automatically when the
    // connection closes, but release explicitly for clarity and so the lock
    // doesn't linger if this connection is ever reused.
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`
    await sql.end()
  }
}

runMigrations()
