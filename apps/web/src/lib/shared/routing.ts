/**
 * URL routing utilities
 *
 * Simplified for single workspace OSS deployment.
 */

/**
 * Get the base URL.
 * On client: uses window.location.origin
 * On server: returns BASE_URL from env or empty string (never throws during SSR)
 *
 * Note: This function is called during SSR where process.env might not be populated.
 * It gracefully returns empty string on server during SSR to avoid breaking the page load.
 * The actual URLs will be constructed correctly on the client using window.location.origin.
 */
export function getBaseUrl(): string {
  // Client-side: always use window.location.origin
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  // Server-side: read from process.env at runtime
  // Using a function call prevents Vite from inlining the value at build time
  try {
    return process.env.BASE_URL || ''
  } catch {
    return ''
  }
}
