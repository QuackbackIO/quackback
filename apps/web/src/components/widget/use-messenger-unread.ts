import { useQuery } from '@tanstack/react-query'
import { useWidgetAuth } from './widget-auth-provider'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { getMessengerUnreadFn } from '@/lib/server/functions/conversation'

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
    queryKey: ['widget', 'messenger-unread', sessionVersion],
    queryFn: () => getMessengerUnreadFn({ headers: getWidgetAuthHeaders() }),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    retry: false,
  })
  return data?.total ?? 0
}
