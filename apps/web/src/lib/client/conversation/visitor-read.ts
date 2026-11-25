import type { QueryClient } from '@tanstack/react-query'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'

/**
 * Refetch every count a visitor's read of a conversation changes: the widget
 * Messages tab list and badge, the widget Home card, and the portal Support
 * list (whose rows also feed the portal header badge). The thread is shared by
 * both surfaces, so both are refreshed; a key with no cached query is a no-op.
 * The Home card is refreshed here as well as by the unread total (see
 * useRefreshSummaryOnUnreadChange), because the polled total can land back
 * where it started, and then it shows no change to follow.
 */
export function refreshVisitorUnreadCounts(queryClient: QueryClient): void {
  for (const queryKey of [
    conversationKeys.widgetConversationLists(),
    conversationKeys.widgetMessengerUnreads(),
    conversationKeys.widgetConversationSummaries(),
    conversationKeys.portalConversationList(),
  ]) {
    void queryClient.invalidateQueries({ queryKey })
  }
}
