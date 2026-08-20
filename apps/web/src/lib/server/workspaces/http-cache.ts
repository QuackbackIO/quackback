/**
 * Cache headers for responses whose body depends on which workspace asked.
 *
 * Under pooled tenancy the `Host` header chooses the database, so a publicly
 * cacheable response is per-workspace content on a URL path that every workspace
 * shares. `/api/widget/config.json` is the same path for all of them and
 * returns a different body for each.
 *
 * An origin server's own cache keys on the full request URI including the
 * authority, so this is safe by default — but a CDN in front of the fleet does
 * not have to. Cache keys are configurable, host-agnostic keys are a common
 * default for single-origin sites, and the plan puts a CDN in front of exactly
 * this fleet. The failure that produces is `SAAS-HOSTING-STACK.md` §3 arriving
 * through the edge rather than through the pool: workspace A's branding, widget
 * configuration and asset served to workspace B, with nothing erroring and nothing
 * in the application logs.
 *
 * `Vary: Host` is the standard signal that says "this body depends on the
 * authority" and is honoured by shared caches that respect `Vary` at all. It is
 * not a substitute for configuring the CDN's cache key correctly — it is the
 * declaration that makes a misconfigured one wrong rather than merely unlucky.
 *
 * Deliberately one helper rather than a literal at each call site: the guard in
 * `__tests__/host-vary.test.ts` scans the route tree for publicly cacheable
 * responses that do not vary on Host, and a scanner is only as good as the
 * consistency of what it scans.
 */

/**
 * `Cache-Control` plus a `Vary` that includes `Host`.
 *
 * @param maxAge seconds
 * @param alsoVaryOn additional `Vary` values (`Accept-Encoding`, …)
 */
export function publicWorkspaceCacheHeaders(
  maxAge: number,
  ...alsoVaryOn: string[]
): { 'Cache-Control': string; Vary: string } {
  return {
    'Cache-Control': `public, max-age=${maxAge}`,
    Vary: ['Host', ...alsoVaryOn].join(', '),
  }
}
