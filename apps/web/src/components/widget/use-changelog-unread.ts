import { useCallback, useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import {
  countUnreadChangelogs,
  getChangelogSeenAt,
  markChangelogSeen,
  CHANGELOG_SEEN_EVENT,
} from './changelog-unread'

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
  const { data } = useInfiniteQuery({
    ...publicChangelogQueries.list(),
    enabled,
    refetchInterval: 60_000,
  })

  // Re-read the marker whenever the changelog surface advances it (same-tab
  // updates don't fire the native `storage` event, hence the custom one).
  const [seenAt, setSeenAt] = useState<string | null>(() => getChangelogSeenAt())
  useEffect(() => {
    const onSeen = () => setSeenAt(getChangelogSeenAt())
    window.addEventListener(CHANGELOG_SEEN_EVENT, onSeen)
    return () => window.removeEventListener(CHANGELOG_SEEN_EVENT, onSeen)
  }, [])

  const entries = data?.pages.flatMap((page) => page.items) ?? []
  const unread = countUnreadChangelogs(entries, seenAt)

  const markSeen = useCallback((publishedAt: string) => markChangelogSeen(publishedAt), [])

  return { unread, markSeen }
}
