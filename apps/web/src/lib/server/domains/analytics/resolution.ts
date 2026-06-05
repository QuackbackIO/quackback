/**
 * Resolution rate: the share of current posts that have reached a terminal
 * status. Status categories are fixed (`active` | `complete` | `closed`), so a
 * post counts as resolved when its status is `complete` or `closed` — this works
 * for any tenant's custom statuses without hardcoding status names.
 */
const TERMINAL_CATEGORIES = new Set(['complete', 'closed'])

export function computeResolutionRate(
  /** Snapshot of post counts keyed by status slug: { "open": 12, ... }. */
  postsByStatus: Record<string, number>,
  /** Maps each status slug to its category. */
  categoryBySlug: Map<string, string>
): { resolvedPosts: number; totalPosts: number; resolutionRate: number } {
  let resolvedPosts = 0
  let totalPosts = 0
  for (const [slug, count] of Object.entries(postsByStatus)) {
    totalPosts += count
    if (TERMINAL_CATEGORIES.has(categoryBySlug.get(slug) ?? '')) {
      resolvedPosts += count
    }
  }
  const resolutionRate = totalPosts > 0 ? Math.round((resolvedPosts / totalPosts) * 100) : 0
  return { resolvedPosts, totalPosts, resolutionRate }
}
