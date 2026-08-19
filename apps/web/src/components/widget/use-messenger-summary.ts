import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { useWidgetAuth } from './widget-auth-provider'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { getMyConversationFn } from '@/lib/server/functions/conversation'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import { useConversationPresence } from './use-messenger-presence'

export interface ConversationSummary {
  conversation: ConversationDTO | null
  teamName: string | null
  agentsOnline: boolean
  withinOfficeHours: boolean | null
}

/** Query key for the visitor's conversation summary, keyed by session version.
 *  The widget loader seeds the initial-session key server-side (cookie-authed
 *  visitors get their summary SSR'd; anonymous get a settled null) so Home
 *  paints complete without a post-render pop-in. */
export const conversationSummaryKey = (sessionVersion: number | string) =>
  ['widget', 'conversation-summary', sessionVersion] as const

/**
 * Lightweight read of the visitor's conversation summary: the most-recent conversation
 * (+ team name) from getMyConversationFn, merged with the shared presence verdict from
 * useConversationPresence. Re-keyed on sessionVersion (Bearer identify swaps the
 * actor, so token-authed visitors refetch after identify). Pass `enabled=false`
 * (e.g. when messenger is off) to skip the fetch entirely.
 *
 * Presence is NOT fetched here — it lives in the one shared useConversationPresence
 * query (SSR-seeded, polled once), so every surface reads the same value.
 */
export function useConversationSummary(enabled: boolean): ConversationSummary {
  const { sessionVersion } = useWidgetAuth()
  const presence = useConversationPresence(enabled)
  const { locale } = useIntl()

  const { data } = useQuery({
    queryKey: conversationSummaryKey(sessionVersion),
    queryFn: async () => {
      const res = await getMyConversationFn({ data: { locale }, headers: getWidgetAuthHeaders() })
      return { conversation: res.conversation ?? null, teamName: res.teamName }
    },
    enabled,
    staleTime: 30_000,
    // The loader seeds the initial key from the cookie/anonymous baseline; a
    // Bearer-token visitor (whose identity SSR can't see) still needs a fresh
    // read, so always revalidate on mount. Cookie visitors get identical data
    // back, so nothing shifts.
    refetchOnMount: 'always',
    retry: false,
  })

  return {
    conversation: data?.conversation ?? null,
    teamName: data?.teamName ?? null,
    agentsOnline: presence.agentsOnline,
    withinOfficeHours: presence.withinOfficeHours,
  }
}
