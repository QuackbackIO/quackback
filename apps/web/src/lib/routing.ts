/**
 * URL routing utilities
 *
 * Simplified for single workspace OSS deployment.
 */

/**
 * Get the root URL.
 * On client: uses window.location.origin
 * On server: requires ROOT_URL env var (for absolute URLs in emails, OAuth callbacks, etc.)
 */
export function getRootUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  const url = process.env.ROOT_URL
  if (!url) {
    throw new Error('ROOT_URL environment variable is required on server')
  }
  return url
}
