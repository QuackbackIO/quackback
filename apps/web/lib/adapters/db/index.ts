/**
 * Database adapter selection
 *
 * Auto-detects the runtime environment and selects the appropriate adapter:
 * - Cloudflare Workers: Uses Hyperdrive adapter (auto-detected)
 * - Node.js / Local dev: Uses DATABASE_URL adapter
 *
 * This module is imported by lib/db/index.ts to initialize the database connection.
 */

import { setDbGetter } from '@quackback/db/client'

let initPromise: Promise<void> | null = null

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
 */
export function initializeDb(): void {
  if (initPromise) return

  initPromise = (async () => {
    if (isCloudflareWorker()) {
      const { getCloudflareDb } = await import('./cloudflare')
      setDbGetter(getCloudflareDb)
    } else {
      const { getNodeDb } = await import('./node')
      setDbGetter(getNodeDb)
    }
  })()
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
