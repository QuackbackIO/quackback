import { useQuery } from '@tanstack/react-query'
import { fetchConversationTagsFn } from '@/lib/server/functions/conversation-tags'

/** The inbox label taxonomy's cache key. The nav's per-tag counts live under
 *  this prefix too, so invalidating it refreshes both the pickers and the badges. */
export const CONVERSATION_TAGS_KEY = ['admin', 'inbox', 'conversation-tags'] as const

/**
 * The workspace's conversation labels, shared by the per-conversation label
 * editor and the bulk-action bar so they read one cache entry. 60s stale: the
 * taxonomy rarely changes within a session. Pass `enabled: false` to hold the
 * fetch until a picker actually opens.
 */
export function useConversationTags(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: CONVERSATION_TAGS_KEY,
    queryFn: () => fetchConversationTagsFn(),
    staleTime: 60_000,
    enabled: options?.enabled,
  })
}
