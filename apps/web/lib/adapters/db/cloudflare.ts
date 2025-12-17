/**
 * Cloudflare Workers database adapter
 *
 * Uses Cloudflare Hyperdrive for PostgreSQL connection pooling.
 * Auto-selected when running in Cloudflare Workers environment.
 *
 * Key differences from Node.js adapter:
 * - Uses getCloudflareContext() to access Hyperdrive binding
 * - Disables prepared statements (Hyperdrive doesn't support them)
 * - Provides async variant for ISR/SSG routes
 */

import { cache } from 'react'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createDb, type Database } from '@quackback/db/client'

// Augment the CloudflareEnv interface with our custom bindings
declare global {
  interface CloudflareEnv {
    HYPERDRIVE: Hyperdrive
  }
}

/**
 * Get database connection via Hyperdrive, memoized per-request.
 * Use this for dynamic routes (server components, API routes, etc.)
 */
export const getCloudflareDb = cache((): Database => {
  const { env } = getCloudflareContext()
  return createDb(env.HYPERDRIVE.connectionString, { prepare: false })
})

/**
 * Get database connection via Hyperdrive for static routes.
 * Use this for ISR/SSG routes where async context is required.
 */
export const getCloudflareDbAsync = cache(async (): Promise<Database> => {
  const { env } = await getCloudflareContext({ async: true })
  return createDb(env.HYPERDRIVE.connectionString, { prepare: false })
})
