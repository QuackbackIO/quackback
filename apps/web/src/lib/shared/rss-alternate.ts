/**
 * The RSS feed a page advertises to feed readers through
 * `<link rel="alternate">`. The status pages offer the status feed; every
 * other page keeps offering the changelog feed, as before.
 *
 * Decided from the matched route ids in the root route's `head`, because
 * TanStack Router concatenates `links` across matches: a child route can add
 * a second feed but cannot replace the root's.
 */
export function rssAlternateLink(routeIds: readonly string[]) {
  const onStatusPage = routeIds.some((id) => id.startsWith('/_portal/status/'))
  return onStatusPage
    ? {
        rel: 'alternate',
        type: 'application/rss+xml',
        title: 'Status RSS Feed',
        href: '/status/feed',
      }
    : {
        rel: 'alternate',
        type: 'application/rss+xml',
        title: 'Changelog RSS Feed',
        href: '/changelog/feed',
      }
}
