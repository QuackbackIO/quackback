/**
 * Widget changelog unread tracking.
 *
 * The visitor's "seen" marker is the publishedAt of the newest changelog
 * entry they have had on screen, kept in window.localStorage (visitor-scoped — the
 * widget's visitor identity already lives client-side). An entry published
 * after the marker is unread; the launcher badge counts those until the
 * visitor opens the changelog surface, which advances the marker.
 *
 * A visitor with no marker yet gets a silent baseline (everything historical
 * is read): the first list load stamps the marker, so only entries published
 * AFTER the visitor's first contact badge as new.
 */

const SEEN_KEY = 'quackback:changelog-seen-at'

/** Event name dispatched on window after the marker advances, so open widget
 *  views re-read it without a reload. */
export const CHANGELOG_SEEN_EVENT = 'quackback:changelog-seen'

export function getChangelogSeenAt(storage?: Storage): string | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(SEEN_KEY)
    if (!raw) return null
    // Guard against a corrupted value: an unparseable marker behaves as no
    // marker rather than poisoning every comparison with NaN.
    return Number.isNaN(new Date(raw).getTime()) ? null : raw
  } catch {
    return null // storage unavailable (private mode etc.)
  }
}

export function markChangelogSeen(publishedAt: string): void {
  const existing = getChangelogSeenAt()
  // The marker only moves forward — an older page of the infinite list must
  // not re-badge entries the visitor already saw.
  if (existing && new Date(existing).getTime() >= new Date(publishedAt).getTime()) return
  try {
    window.localStorage.setItem(SEEN_KEY, publishedAt)
  } catch {
    // Storage unavailable — the badge returns next load; never break the view.
  }
  window.dispatchEvent(new Event(CHANGELOG_SEEN_EVENT))
}

/**
 * Entries with a publishedAt strictly after the marker are unread. A null
 * marker means the visitor has never seen the list, so nothing badges until
 * the first load stamps the baseline (see module doc).
 */
export function countUnreadChangelogs(
  entries: readonly { publishedAt: string }[],
  seenAt: string | null
): number {
  if (!seenAt) return 0
  const seen = new Date(seenAt).getTime()
  return entries.filter((e) => new Date(e.publishedAt).getTime() > seen).length
}
