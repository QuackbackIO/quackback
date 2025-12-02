/**
 * Database reset script for development.
 * Drops all tables and recreates them.
 *
 * WARNING: This will delete all data!
 *
 * Usage: bun run db:reset
 */
import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL!
const client = postgres(connectionString, {
  onnotice: () => {}, // Suppress PostgreSQL NOTICE messages
})

async function reset() {
  console.log('Resetting database...\n')
  console.log('WARNING: This will delete all data!\n')

  // Drop all tables in public schema
  await client`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `

  // Drop custom types
  await client`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype = 'e') LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `

  // Drop the app_user role if it exists
  await client`
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        EXECUTE 'DROP ROLE app_user';
      END IF;
    END $$;
  `

  console.log('Database reset complete!')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Push schema:  bun run db:push')
  console.log('  2. Seed data:    bun run db:seed')
  console.log('')

  await client.end()
}

reset().catch((error) => {
  console.error('Reset failed:', error)
  process.exitCode = 1
})
