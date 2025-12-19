/**
 * Database adapter selection
 *
 * Auto-detects the runtime environment and selects the appropriate adapter:
 * - Cloudflare Workers: Uses Hyperdrive adapter (auto-detected)
 * - Node.js / Local dev: Uses DATABASE_URL adapter
 *
 * This module is imported by lib/db/index.ts to initialize the database connection.
 */

import { setDbGetter, createDb, type Database } from '@quackback/db/client'

// Track initialization to avoid duplicate setup in hot reload
let initialized = false

// Use globalThis to persist database instance across hot reloads in development
declare global {
  var __db_instance: Database | undefined
}

/**
 * Detect if we're running in Cloudflare Workers environment.
 * Checks for the Cloudflare-specific caches.default API.
 */
function isCloudflareWorker(): boolean {
  try {
    return (
      typeof globalThis !== 'undefined' &&
      'caches' in globalThis &&
      typeof (globalThis as unknown as { caches: { default?: unknown } }).caches?.default !==
        'undefined'
    )
  } catch {
    return false
  }
}

/**
 * Initialize the database connection based on runtime environment.
 * Auto-detects Cloudflare Workers and uses Hyperdrive when available.
 *
 * This is synchronous - it sets up a lazy getter that resolves the connection
 * on first use within each request context.
 *
 * Uses globalThis to persist database instance across hot reloads in dev mode.
 */
export function initializeDb(): void {
  if (initialized) return
  initialized = true

  if (isCloudflareWorker()) {
    // Cloudflare Workers: Use Hyperdrive via lazy getter
    // The getter is called per-request and uses getCloudflareContext()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare')

    setDbGetter((): Database => {
      const { env } = getCloudflareContext()
      return createDb(env.HYPERDRIVE.connectionString, { prepare: true, max: 5 })
    })
  } else {
    // Node.js / Local dev: Use DATABASE_URL with cached instance
    setDbGetter((): Database => {
      // Return cached instance if available (persists across hot reloads)
      if (globalThis.__db_instance) {
        return globalThis.__db_instance
      }

      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is required')
      }

      // Create and cache the database instance
      // Use larger pool for development to handle concurrent requests
      globalThis.__db_instance = createDb(connectionString, { max: 50 })
      return globalThis.__db_instance
    })
  }
}

/**
 * Get database connection asynchronously (for ISR/SSG routes in Cloudflare).
 */
export async function getDbAsync() {
  if (isCloudflareWorker()) {
    const { getCloudflareDbAsync } = await import('./cloudflare')
    return getCloudflareDbAsync()
  }

  const { getNodeDb } = await import('./node')
  return getNodeDb()
}

// Re-export everything from the db package for convenience
export * from '@quackback/db'
export * from '@quackback/db/types'
