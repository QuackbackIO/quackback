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
    // Run Drizzle migrations (creates tables, RLS policies, and roles)
    await migrate(db, { migrationsFolder: './drizzle' })
    console.log('✅ Schema migrations completed')

    // Grant permissions to app_user role
    // This runs after migrations to ensure the role and tables exist
    console.log('🔄 Granting permissions to app_user...')

    await sql`GRANT USAGE ON SCHEMA public TO app_user`
    await sql`GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user`
    await sql`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user`
    await sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user`
    await sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user`

    console.log('✅ Permissions granted')
    console.log('')
    console.log('🎉 Migrations completed successfully!')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

runMigrations()
