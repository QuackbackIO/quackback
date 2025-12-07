import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  console.log('🔄 Running migrations...')

  // Use a single connection for migrations
  const sql = postgres(connectionString, { max: 1 })
  const db = drizzle(sql)

  try {
    // Run Drizzle migrations
    // This creates tables, RLS policies, roles, and grants permissions
    // (app_user permissions are granted in migration 0010_grant_app_user_permissions.sql)
    await migrate(db, { migrationsFolder: './drizzle' })
    console.log('✅ Migrations completed successfully!')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

runMigrations()
