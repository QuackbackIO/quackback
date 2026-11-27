import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { widgetChangelogListQuery } from './widget-changelog-query'
import { useWidgetAuth } from './widget-auth-provider'
import {
  changelogBaseline,
  countUnreadChangelogs,
  newestUnreadChangelog,
  getChangelogSeenAt,
  isChangelogSeenKey,
  markChangelogSeen,
  touchChangelogSeen,
  CHANGELOG_SEEN_EVENT,
} from './changelog-unread'
import { seenScope } from './seen-scope'

type UnreadEntry = { id: string; title: string; content: string; publishedAt: string }

/**
 * Unread changelog count for the visitor and the newest unread entry, plus
 * the mark-seen action the changelog surface calls once entries are on screen. Pass `enabled=false`
 * (changelog tab off) to skip the fetch. Polls so an entry published while
 * the host page sits open badges without a reload.
 */
export function useChangelogUnread(enabled: boolean): {
  unread: number
  /** The newest unread entry, or null. */
  newest: UnreadEntry | null
  /** The unread entries the "What's new" card may announce: an entry can opt
   *  out, and still counts towards `unread`. */
  announced: { count: number; newest: UnreadEntry | null; more: boolean }
  /** Whether the list has loaded, so "nothing unread" is known. */
  ready: boolean
  /** Every loaded entry is unread and more pages exist: `unread` is a lower
   *  bound. */
  more: boolean
  markSeen: (publishedAt: string) => void
} {
  const { sessionVersion, user, identityResolved } = useWidgetAuth()
  // Null until the identity round trip settles: no marker is read or written
  // for a visitor the widget cannot yet tell apart, and the badge stays 0.
  const scope = seenScope(user, identityResolved)
  const { data, hasNextPage } = useInfiniteQuery({
    ...widgetChangelogListQuery(sessionVersion),
    enabled,
    refetchInterval: 60_000,
  })

  // Re-read the marker whenever the changelog surface advances it (same-tab
  // updates don't fire the native `storage` event, hence the custom one).
  const [markerVersion, reread] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    // Another tab reading the changelog advances the shared marker; the
    // native `storage` event carries that here (null key: storage cleared).
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || isChangelogSeenKey(e.key)) reread()
    }
    window.addEventListener(CHANGELOG_SEEN_EVENT, reread)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGELOG_SEEN_EVENT, reread)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  // Read once per person and per marker change, not every render.
  const seenAt = useMemo(
    () => (scope === null ? null : getChangelogSeenAt(scope)),
    // markerVersion is the re-read trigger: storage is not React state.
    [scope, markerVersion]
  )

  const entries = data?.pages.flatMap((page) => page.items) ?? []
  const unread = countUnreadChangelogs(entries, seenAt)
  const newest = newestUnreadChangelog(entries, seenAt)

  // Showing the badge counts as activity, so a person whose marker has nothing
  // new to record keeps it on a browser shared by many (see seen-scope.ts).
  useEffect(() => {
    if (scope !== null) touchChangelogSeen(scope)
  }, [scope])

  // Silent first-contact baseline: what was published before the visitor
  // first met the widget never badges, and later entries do, whether or not
  // they ever open the Changelog tab. The baseline is the server's time of
  // the first load (see changelogBaseline in changelog-unread.ts).
  const loaded = data !== undefined
  const baseline = loaded ? changelogBaseline(entries, data.pages[0]?.serverTime) : null
  useEffect(() => {
    if (scope === null || baseline === null || getChangelogSeenAt(scope) !== null) return
    markChangelogSeen(scope, baseline)
  }, [baseline, scope])

  const markSeen = useCallback(
    (publishedAt: string) => {
      if (scope !== null) markChangelogSeen(scope, publishedAt)
    },
    [scope]
  )

  const more = unread > 0 && unread === entries.length && hasNextPage === true

  // An entry from an older server without the field is announced.
  const announceable = entries.filter((e) => e.announceOnLauncher !== false)
  const announcedCount = countUnreadChangelogs(announceable, seenAt)
  const announced = {
    count: announcedCount,
    newest: newestUnreadChangelog(announceable, seenAt),
    // Every loaded entry is unread and more exist: later pages may hold more.
    more: announcedCount > 0 && more,
  }

  return { unread, newest, announced, ready: loaded, more, markSeen }
}
