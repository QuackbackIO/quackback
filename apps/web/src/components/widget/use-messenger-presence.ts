import { useQuery, type QueryClient } from '@tanstack/react-query'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { getConversationPresenceFn } from '@/lib/server/functions/conversation'
import {
  CONVERSATION_PRESENCE_POLL_MS,
  type ConversationPresence,
} from '@/lib/shared/conversation/presence'

/**
 * Stable, tenant-global query key — presence is the same for every visitor, so
 * it is NOT keyed by session. The widget loader seeds this via
 * `queryClient.setQueryData` for an SSR-correct first paint (see widget/index).
 */
export const CHAT_PRESENCE_QUERY_KEY = ['widget', 'chat-presence'] as const

const OFFLINE: ConversationPresence = {
  agentsOnline: false,
  withinOfficeHours: null,
  nextOpenAt: null,
}

/**
 * The single source of truth for the widget's team-availability verdict. Every
 * presence surface (Home overview, the Messages CTA, the chat thread) reads from
 * this one query, so they can never disagree and only ONE poll runs no matter
 * how many surfaces are mounted (React Query dedupes by key).
 *
 * SSR-seeded by the loader, then polled every CONVERSATION_PRESENCE_POLL_MS while the
 * widget is open. Pass `enabled=false` (chat off) to skip the query entirely.
 */
export function useConversationPresence(enabled: boolean): ConversationPresence {
  const { data } = useQuery({
    queryKey: CHAT_PRESENCE_QUERY_KEY,
    queryFn: () => getConversationPresenceFn({ headers: getWidgetAuthHeaders() }),
    enabled,
    refetchInterval: CONVERSATION_PRESENCE_POLL_MS,
    // The SSR seed is fresh at page load, so trust it across the first interval
    // rather than double-fetching on mount; the interval keeps it current.
    staleTime: CONVERSATION_PRESENCE_POLL_MS,
    // Intentional (React Query defaults): polling pauses while the iframe is
    // backgrounded — a widget no one is looking at needs no live presence — and
    // resumes / refetches on refocus. Cheaper than the old always-on setInterval.
  })
  return data ?? OFFLINE
}

/**
 * Optimistically mark the team online in the shared presence cache — used when
 * the chat SSE delivers agent activity ("an agent is clearly here right now").
 * Writing to the cache (not local state) means every presence surface updates,
 * and the next poll re-syncs to the authoritative value. (The write also resets
 * the query's refetch timer, deferring that re-sync while activity continues —
 * harmless, since an actively-messaging agent already reads as available.)
 */
export function markAgentPresentInCache(queryClient: QueryClient): void {
  queryClient.setQueryData<ConversationPresence>(CHAT_PRESENCE_QUERY_KEY, (prev) =>
    prev ? { ...prev, agentsOnline: true } : { ...OFFLINE, agentsOnline: true }
  )
}
