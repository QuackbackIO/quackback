import type { Query, QueryClient } from '@tanstack/react-query'
import type { ConversationId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { inboxKeys } from '@/lib/client/queries/inbox'

type ItemListPage = { items: InboxItemDTO[] }
type ConversationListPage = { conversations: ConversationDTO[] }

/**
 * Carry an agent-side read of one conversation into every cached inbox list.
 *
 * A read moves only the row's unread badge: no list filters or sorts on it,
 * so no row joins, leaves or moves. Patching the row in place replaces a
 * refetch of each list.
 *
 * `at` is the watermark a read event carries. A row whose last message is
 * newer than it still has unread messages (a "mark unread" moves the
 * watermark back), and a list mid-fetch may land a snapshot taken before the
 * read; both are refetched instead of patched. Without `at` (the caller's own
 * read, just written) the row is cleared outright.
 */
export function applyConversationReadToLists(
  queryClient: QueryClient,
  conversationId: ConversationId,
  at?: string
): void {
  const cache = queryClient.getQueryCache()
  const readRow = (row: ConversationDTO): ConversationDTO | 'refetch' | null => {
    if (at && Date.parse(row.lastMessageAt) > Date.parse(at)) return 'refetch'
    const agentLastReadAt = at ?? row.agentLastReadAt
    if (row.unreadCount === 0 && row.agentLastReadAt === agentLastReadAt) return null
    return { ...row, unreadCount: 0, agentLastReadAt }
  }
  const refetch = (query: Query) =>
    void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true })

  for (const query of cache.findAll({ queryKey: inboxKeys.items() })) {
    const page = query.state.data as ItemListPage | undefined
    const index =
      page?.items.findIndex(
        (item) => item.kind === 'conversation' && item.conversation.id === conversationId
      ) ?? -1
    if (!page || index < 0) continue
    if (query.state.fetchStatus === 'fetching') {
      refetch(query)
      continue
    }
    const item = page.items[index] as Extract<InboxItemDTO, { kind: 'conversation' }>
    const next = readRow(item.conversation)
    if (next === 'refetch') refetch(query)
    else if (next) {
      const items = page.items.slice()
      items[index] = { ...item, conversation: next }
      queryClient.setQueryData(query.queryKey, { ...page, items })
    }
  }

  for (const query of cache.findAll({ queryKey: conversationKeys.agentConversations() })) {
    const page = query.state.data as ConversationListPage | undefined
    const index = page?.conversations.findIndex((row) => row.id === conversationId) ?? -1
    if (!page || index < 0) continue
    if (query.state.fetchStatus === 'fetching') {
      refetch(query)
      continue
    }
    const next = readRow(page.conversations[index])
    if (next === 'refetch') refetch(query)
    else if (next) {
      const conversations = page.conversations.slice()
      conversations[index] = next
      queryClient.setQueryData(query.queryKey, { ...page, conversations })
    }
  }
}
