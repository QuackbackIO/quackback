import { useEffect, useState } from 'react'
import { useWidgetAuth } from './widget-auth-provider'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { getMyChatFn, getChatPresenceFn } from '@/lib/server/functions/chat'
import type { ConversationDTO } from '@/lib/shared/chat/types'

export interface ChatSummary {
  conversation: ConversationDTO | null
  teamName: string | null
  agentsOnline: boolean
  withinOfficeHours: boolean | null
}

const EMPTY: ChatSummary = {
  conversation: null,
  teamName: null,
  agentsOnline: false,
  withinOfficeHours: null,
}

/**
 * Lightweight read of the visitor's chat summary (most-recent conversation +
 * presence) from getMyChatFn, re-keyed on sessionVersion. Shared by the Home
 * overview and the Help Messages section so the resume card and presence stay
 * consistent across both. Pass `enabled=false` (e.g. when chat is off) to skip
 * the fetch entirely.
 */
export function useChatSummary(enabled: boolean): ChatSummary {
  const { sessionVersion } = useWidgetAuth()
  const [summary, setSummary] = useState<ChatSummary>(EMPTY)

  useEffect(() => {
    if (!enabled) {
      setSummary(EMPTY)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await getMyChatFn({ headers: getWidgetAuthHeaders() })
        if (cancelled) return
        setSummary({
          conversation: res.conversation ?? null,
          teamName: res.teamName,
          agentsOnline: res.agentsOnline,
          withinOfficeHours: res.withinOfficeHours,
        })
      } catch {
        /* not signed in / no conversation — keep defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, sessionVersion])

  // Keep the online/offline indicator fresh while the widget is open by polling
  // the lightweight presence endpoint (the initial load already seeded it).
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const id = setInterval(() => {
      void getChatPresenceFn({ headers: getWidgetAuthHeaders() })
        .then((p) => {
          if (cancelled) return
          setSummary((prev) => ({
            ...prev,
            agentsOnline: p.agentsOnline,
            withinOfficeHours: p.withinOfficeHours,
          }))
        })
        .catch(() => {})
    }, 45_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled, sessionVersion])

  return summary
}
