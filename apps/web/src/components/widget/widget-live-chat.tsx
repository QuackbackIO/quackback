import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ConversationId } from '@quackback/ids'
import { VisitorChatThread } from '@/components/shared/chat/visitor-chat-thread'
import { useWidgetAuth } from './widget-auth-provider'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useChatPresence, markAgentPresentInCache } from './use-chat-presence'
import { useWidgetImageUpload } from '@/lib/client/hooks/use-image-upload'

interface WidgetLiveChatProps {
  /** Whether the help center is available (gates in-chat article suggestions). */
  helpEnabled?: boolean
  /** Open a help article by slug (switches the widget to the article view). */
  onArticleSelect?: (slug: string) => void
  /** Which thread to open: an id opens that thread, 'new' starts a fresh one,
   *  undefined resumes the visitor's active/most-recent thread. */
  conversationTarget?: ConversationId | 'new'
  /** When true, render link preview cards below message bubbles. */
  linkPreviews?: boolean
}

/**
 * The widget's chat tab: the shared visitor thread wired to widget-specific
 * concerns — Bearer-token auth, lazy anonymous session minting, the widget
 * upload endpoint, the shared presence query, and help-center deflection via
 * the widget KB search API.
 */
export function WidgetLiveChat({
  helpEnabled,
  onArticleSelect,
  conversationTarget,
  linkPreviews = false,
}: WidgetLiveChatProps = {}) {
  const queryClient = useQueryClient()
  const { user, ensureSession, sessionVersion } = useWidgetAuth()
  // Presence (online/offline + office hours) comes from the one shared query —
  // SSR-seeded, polled once, and shared with every other widget surface.
  const presence = useChatPresence(true)
  const { upload } = useWidgetImageUpload()

  const onAgentActivity = useCallback(() => markAgentPresentInCache(queryClient), [queryClient])

  const helpSearch = useMemo(() => {
    if (!helpEnabled || !onArticleSelect) return undefined
    return {
      search: async (q: string, signal: AbortSignal) => {
        const res = await fetch(`/api/widget/kb-search?q=${encodeURIComponent(q)}&limit=3`, {
          signal,
          headers: getWidgetAuthHeaders(),
        })
        if (!res.ok) return []
        const json = (await res.json()) as {
          data?: { articles?: Array<{ slug: string; title: string }> }
        }
        return json.data?.articles ?? []
      },
      onSelect: onArticleSelect,
    }
  }, [helpEnabled, onArticleSelect])

  return (
    <VisitorChatThread
      surface="widget"
      conversationTarget={conversationTarget}
      linkPreviews={linkPreviews}
      getAuthHeaders={getWidgetAuthHeaders}
      ensureSession={ensureSession}
      sessionVersion={sessionVersion}
      currentUser={user}
      uploadImage={upload}
      presence={presence}
      onAgentActivity={onAgentActivity}
      helpSearch={helpSearch}
      embedOpenMode="newTab"
    />
  )
}
