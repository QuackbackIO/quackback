/**
 * Database barrel file for the web app.
 *
 * IMPORTANT: Always import database utilities from '@/lib/db', never from '@quackback/db'.
 * This ensures the database connection is properly initialized.
 *
 * @example
 * import { db, eq, and, posts } from '@/lib/db'
 *
 * The database adapter is auto-detected based on runtime environment:
 * - Cloudflare Workers: Uses Hyperdrive
 * - Node.js / Local dev: Uses DATABASE_URL
 */

import { initializeDb, getDbAsync } from '@/lib/adapters/db'

// Initialize database connection on module load
initializeDb()

// Re-export everything from the adapters (which re-exports from @quackback/db)
export * from '@/lib/adapters/db'

// Re-export query helpers
export * from '@quackback/db/queries/usage'

// Export async database getter for Cloudflare ISR/SSG routes
export { getDbAsync }

// Export initialization utilities for advanced use cases
export { createDb, setDbGetter, getDb } from '@quackback/db/client'
