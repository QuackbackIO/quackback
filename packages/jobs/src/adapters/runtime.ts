/**
 * Runtime detection utilities for adapter selection.
 *
 * Detects whether we're running in Cloudflare Workers or Node.js/Bun
 * to select the appropriate job and state adapters.
 */

/**
 * Detect if we're running in Cloudflare Workers environment.
 * Checks for the Cloudflare-specific caches.default API.
 */
export function isCloudflareWorker(): boolean {
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
 * Check if REDIS_URL is available (required for BullMQ adapters).
 */
export function hasRedisConfig(): boolean {
  return !!process.env.REDIS_URL
}
