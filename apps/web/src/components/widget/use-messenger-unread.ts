import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { useWidgetAuth } from './widget-auth-provider'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { widgetGetMessengerUnreadFn } from '@/lib/server/functions/widget/conversation'
import { fetchConversationSummary } from './use-messenger-summary'

/**
 * Total unread across ALL the visitor's conversations, for the messenger tab
 * badge — the aggregate the per-thread `unreadCount` can't give a single badge.
 * Re-keyed on sessionVersion (Bearer identify swaps the actor). Pass
 * `enabled=false` (e.g. messenger off) to skip the fetch. Polls on a modest
 * interval so a reply surfaces on this surface even without a live stream.
 * Undefined until the first count arrives.
 */
export function useMessengerUnread(enabled: boolean): number | undefined {
  const { sessionVersion } = useWidgetAuth()
  const { data } = useQuery({
    queryKey: conversationKeys.widgetMessengerUnread(sessionVersion),
    queryFn: () => widgetGetMessengerUnreadFn({ headers: getWidgetAuthHeaders() }),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    retry: false,
  })
  return data?.total
}

/**
 * Refresh the Home card when the visitor's unread total moves. The total is
 * already polled for the badges, and a read refreshes it: a reply that
 * arrives while Home sits open, or a read made elsewhere, changes it, and the
 * card follows without a poll of its own. It refetches even while Home is
 * off screen, so going back to Home never shows the count from before. The
 * first count after a load or an identity change is not a change. A widget
 * without Home (`hasHome` false) never shows the card, so never fetches it.
 *
 * It fetches with the fetch function in hand, because the loader seeds the
 * card with data only, and a card nobody has shown yet has no other way to
 * refetch. A fetch already running, such as the one a read starts, is joined
 * rather than repeated.
 */
export function useRefreshSummaryOnUnreadChange(total: number | undefined, hasHome: boolean): void {
  const { sessionVersion } = useWidgetAuth()
  const { locale } = useIntl()
  const queryClient = useQueryClient()
  const last = useRef(total)
  useEffect(() => {
    const previous = last.current
    if (total === previous) return
    last.current = total
    if (!hasHome || previous === undefined || total === undefined) return
    void queryClient.prefetchQuery({
      queryKey: conversationKeys.widgetConversationSummary(sessionVersion),
      queryFn: () => fetchConversationSummary(locale),
      staleTime: 0,
      retry: false,
    })
  }, [total, hasHome, sessionVersion, locale, queryClient])
}
