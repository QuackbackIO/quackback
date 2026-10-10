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
  if (typeof url !== 'string' || url.length === 0) return false
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return false
  // Browsers drop tab, CR and LF (and trim other C0 controls) before parsing,
  // so "/\t/evil.com" would be fetched as "//evil.com". No real path carries one.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(url)) return false
  // Belt and braces: whatever survived must still resolve to this origin.
  try {
    const origin = 'https://callback.invalid'
    return new URL(url, origin).origin === origin
  } catch {
    return false
  }
}

/** Consume a widget OTT on `/auth/widget-handoff` (teammate cookie guard lives there). */
export function widgetHandoffPath(ott: string, returnTo: string): string {
  const params = new URLSearchParams({ ott, returnTo })
  return `/auth/widget-handoff?${params.toString()}`
}

/** True when a (safe, relative) callback URL targets a team surface, so the
 *  login should serve the always-on team form (break-glass), not the public
 *  portal form. Covers /admin and the team-invitation accept flow.
 *  Matches each prefix exactly or as a path segment — never `/administrator…`. */
export function isTeamCallback(callbackUrl: string | undefined): boolean {
  if (!callbackUrl) return false
  const teamPrefixes = ['/admin', '/complete-signup']
  // Compare the path only: "/admin?post=1" and "/admin#plan" are team targets.
  const path = callbackUrl.split(/[?#]/, 1)[0]
  return teamPrefixes.some((p) => path === p || path.startsWith(p + '/'))
}
