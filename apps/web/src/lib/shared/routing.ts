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
  return (
    typeof url === 'string' &&
    url.length > 0 &&
    url.startsWith('/') &&
    !url.startsWith('//') &&
    !url.includes('\\')
  )
}

/** True when a (safe, relative) callback URL targets a team surface, so the
 *  login should serve the always-on team form (break-glass), not the public
 *  portal form. Covers /admin and the team-invitation accept flow.
 *  Matches each prefix exactly or as a path segment — never `/administrator…`. */
export function isTeamCallback(callbackUrl: string | undefined): boolean {
  if (!callbackUrl) return false
  const teamPrefixes = ['/admin', '/complete-signup']
  return teamPrefixes.some((p) => callbackUrl === p || callbackUrl.startsWith(p + '/'))
}
