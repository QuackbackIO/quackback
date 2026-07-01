import { useEffect, useState } from 'react'
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

/**
 * Lightweight read of the visitor's conversation summary: the most-recent conversation
 * (+ team name) from getMyConversationFn, merged with the shared presence verdict from
 * useConversationPresence. Re-keyed on sessionVersion. Shared by the Home overview and
 * the Help Messages section so the resume card and presence stay consistent.
 * Pass `enabled=false` (e.g. when messenger is off) to skip the fetch entirely.
 *
 * Presence is NOT fetched here — it lives in the one shared useConversationPresence
 * query (SSR-seeded, polled once), so every surface reads the same value.
 */
export function useConversationSummary(enabled: boolean): ConversationSummary {
  const { sessionVersion } = useWidgetAuth()
  const presence = useConversationPresence(enabled)
  const [thread, setThread] = useState<{
    conversation: ConversationDTO | null
    teamName: string | null
  }>({ conversation: null, teamName: null })

  useEffect(() => {
    if (!enabled) {
      setThread({ conversation: null, teamName: null })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await getMyConversationFn({ headers: getWidgetAuthHeaders() })
        if (cancelled) return
        setThread({ conversation: res.conversation ?? null, teamName: res.teamName })
      } catch {
        /* not signed in / no conversation — keep defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, sessionVersion])

  return {
    conversation: thread.conversation,
    teamName: thread.teamName,
    agentsOnline: presence.agentsOnline,
    withinOfficeHours: presence.withinOfficeHours,
  }
}
