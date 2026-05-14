/**
 * URL routing utilities
 *
 * Simplified for single workspace OSS deployment.
 */

/**
 * Same-origin safety check for callback / redirect URLs:
 * `/`-prefixed AND not protocol-relative (`//evil.com/x` would otherwise
 * look local). Used by every callback-URL handler so the rule lives in
 * one place.
 */
export function isSafeCallbackUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length > 0 && url.startsWith('/') && !url.startsWith('//')
}

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
