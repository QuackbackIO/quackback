import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { widgetChangelogListQuery } from './widget-changelog-query'
import { useWidgetAuth } from './widget-auth-provider'
import {
  countUnreadChangelogs,
  EMPTY_CHANGELOG_BASELINE,
  getChangelogSeenAt,
  markChangelogSeen,
  touchChangelogSeen,
  CHANGELOG_SEEN_EVENT,
} from './changelog-unread'
import { seenScope } from './seen-scope'

/**
 * Unread changelog count for the visitor, plus the mark-seen action the
 * changelog surface calls once entries are on screen. Pass `enabled=false`
 * (changelog tab off) to skip the fetch. Polls so an entry published while
 * the host page sits open badges without a reload.
 */
export function useChangelogUnread(enabled: boolean): {
  unread: number
  markSeen: (publishedAt: string) => void
} {
  const { sessionVersion, user, identityResolved } = useWidgetAuth()
  // Null until the identity round trip settles: no marker is read or written
  // for a visitor the widget cannot yet tell apart, and the badge stays 0.
  const scope = seenScope(user, identityResolved)
  const { data } = useInfiniteQuery({
    ...widgetChangelogListQuery(sessionVersion),
    enabled,
    refetchInterval: 60_000,
  })

  // Re-read the marker whenever the changelog surface advances it (same-tab
  // updates don't fire the native `storage` event, hence the custom one).
  const [markerVersion, reread] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    window.addEventListener(CHANGELOG_SEEN_EVENT, reread)
    return () => window.removeEventListener(CHANGELOG_SEEN_EVENT, reread)
  }, [])
  // Read once per person and per marker change, not every render.
  const seenAt = useMemo(
    () => (scope === null ? null : getChangelogSeenAt(scope)),
    // markerVersion is the re-read trigger: storage is not React state.
    [scope, markerVersion]
  )

  const entries = data?.pages.flatMap((page) => page.items) ?? []
  const unread = countUnreadChangelogs(entries, seenAt)

  // Showing the badge counts as activity, so a person whose marker has nothing
  // new to record keeps it on a browser shared by many (see seen-scope.ts).
  useEffect(() => {
    if (scope !== null) touchChangelogSeen(scope)
  }, [scope])

  // Silent first-contact baseline: what was published before the visitor
  // first met the widget never badges, and later entries do, whether or not
  // they ever open the Changelog tab (see changelog-unread.ts). An empty
  // changelog stamps a baseline older than anything, so its first entry badges.
  const loaded = data !== undefined
  const newest = entries[0]?.publishedAt
  useEffect(() => {
    if (scope === null || !loaded || getChangelogSeenAt(scope) !== null) return
    markChangelogSeen(scope, newest ?? EMPTY_CHANGELOG_BASELINE)
  }, [loaded, newest, scope])

  const markSeen = useCallback(
    (publishedAt: string) => {
      if (scope !== null) markChangelogSeen(scope, publishedAt)
    },
    [scope]
  )

  return { unread, markSeen }
}
