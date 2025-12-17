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

let initialized = false

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
    // Node.js / Local dev: Use DATABASE_URL
    setDbGetter((): Database => {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is required')
      }
      return createDb(connectionString, { max: 10 })
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
