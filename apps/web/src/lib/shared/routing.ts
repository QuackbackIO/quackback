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

/** True when a (safe, relative) callback URL targets a team surface, so the
 *  login should serve the always-on team form (break-glass), not the public
 *  portal form. Covers /admin, the team-invitation accept flow, and 2FA setup.
 *  Matches each prefix exactly or as a path segment — never `/administrator…`. */
export function isTeamCallback(callbackUrl: string | undefined): boolean {
  if (!callbackUrl) return false
  const teamPrefixes = ['/admin', '/complete-signup', '/auth/two-factor-setup-required']
  return teamPrefixes.some((p) => callbackUrl === p || callbackUrl.startsWith(p + '/'))
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
