import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '../../.env' })

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  entities: {
    roles: {
      // Don't try to create roles in drizzle push/migrate
      // The app_user role should be created manually or in a separate migration
      provider: 'supabase',
      exclude: ['postgres', 'pg_*', 'app_user'],
    },
  },
})
