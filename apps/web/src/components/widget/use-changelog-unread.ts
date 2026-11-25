import { useCallback, useEffect, useReducer } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { widgetChangelogListQuery } from './widget-changelog-query'
import { useWidgetAuth } from './widget-auth-provider'
import {
  countUnreadChangelogs,
  getChangelogSeenAt,
  markChangelogSeen,
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
  const { sessionVersion, user } = useWidgetAuth()
  const scope = seenScope(user)
  const { data } = useInfiniteQuery({
    ...widgetChangelogListQuery(sessionVersion),
    enabled,
    refetchInterval: 60_000,
  })

  // Re-read the marker whenever the changelog surface advances it (same-tab
  // updates don't fire the native `storage` event, hence the custom one).
  const [, reread] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    window.addEventListener(CHANGELOG_SEEN_EVENT, reread)
    return () => window.removeEventListener(CHANGELOG_SEEN_EVENT, reread)
  }, [])
  const seenAt = getChangelogSeenAt(scope)

  const entries = data?.pages.flatMap((page) => page.items) ?? []
  const unread = countUnreadChangelogs(entries, seenAt)

  const markSeen = useCallback(
    (publishedAt: string) => markChangelogSeen(scope, publishedAt),
    [scope]
  )

  return { unread, markSeen }
}
