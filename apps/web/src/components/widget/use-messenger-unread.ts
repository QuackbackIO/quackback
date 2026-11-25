import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWidgetAuth } from './widget-auth-provider'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { widgetGetMessengerUnreadFn } from '@/lib/server/functions/widget/conversation'

/**
 * Total unread across ALL the visitor's conversations, for the messenger tab
 * badge — the aggregate the per-thread `unreadCount` can't give a single badge.
 * Re-keyed on sessionVersion (Bearer identify swaps the actor). Pass
 * `enabled=false` (e.g. messenger off) to skip the fetch. Polls on a modest
 * interval so a reply surfaces on this surface even without a live stream.
 */
export function useMessengerUnread(enabled: boolean): number {
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
  return data?.total ?? 0
}

/**
 * Refresh the Home card when the visitor's unread total moves. The total is
 * already polled for the badges; a reply that arrives while Home sits open
 * changes it, and the card's preview and count follow without a poll of
 * their own.
 */
export function useRefreshSummaryOnUnreadChange(total: number): void {
  const queryClient = useQueryClient()
  const last = useRef(total)
  useEffect(() => {
    if (total === last.current) return
    last.current = total
    void queryClient.invalidateQueries({ queryKey: conversationKeys.widgetConversationSummaries() })
  }, [total, queryClient])
}
