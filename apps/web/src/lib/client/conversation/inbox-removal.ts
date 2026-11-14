import type { QueryClient } from '@tanstack/react-query'
import type { InboxItemDTO, InboxItemRef } from '@/lib/shared/inbox/items'
import { itemRefId, type ConversationListPage, type ItemListPage } from './inbox-cache'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { inboxKeys, ticketKeys } from '@/lib/client/queries/inbox'
import { isNotFoundError } from '@/lib/shared/errors'

/**
 * The teammate's role or teams changed (`inbox_scope_changed`), so the open
 * item may have left their scope, and nothing says which. Refetch it: when the
 * server now answers Not found, it goes through the same removal as an item
 * reassigned away, so an open ticket pane shows Not found instead of the
 * ticket it kept from before. Any other answer leaves the caches as fetched.
 */
export async function settleOpenItemAfterScopeChange(
  queryClient: QueryClient,
  open: InboxItemRef
): Promise<void> {
  const queryKey =
    open.kind === 'ticket' ? ticketKeys.detail(open.id) : conversationKeys.agentThread(open.id)
  if (!queryClient.getQueryState(queryKey)) return
  try {
    await queryClient.fetchQuery({ queryKey, staleTime: 0 })
  } catch (err) {
    if (isNotFoundError(err)) removeInboxItemFromCaches(queryClient, open)
  }
}

/**
 * An item left this teammate's scope (`inbox_item_removed` on the inbox
 * stream): take it out of every cached list now, and drop its cached thread
 * and detail.
 *
 * The caches are reset, not only marked stale. An open pane refetches, the
 * server answers not found, and the pane shows its not-found state. The
 * ticket pane shows that state only when it has no data, and a failed
 * refetch keeps old data, so marking stale alone would leave the ticket on
 * screen.
 */
export function removeInboxItemFromCaches(queryClient: QueryClient, ref: InboxItemRef): void {
  const isItem = (item: InboxItemDTO) => item.kind === ref.kind && itemRefId(item) === ref.id
  queryClient.setQueriesData<ItemListPage>({ queryKey: inboxKeys.items() }, (prev) =>
    prev && prev.items.some(isItem)
      ? { ...prev, items: prev.items.filter((i) => !isItem(i)) }
      : prev
  )
  if (ref.kind === 'conversation') {
    queryClient.setQueriesData<ConversationListPage>(
      { queryKey: conversationKeys.agentConversations() },
      (prev) =>
        prev?.conversations?.some((c) => c.id === ref.id)
          ? { ...prev, conversations: prev.conversations.filter((c) => c.id !== ref.id) }
          : prev
    )
    void queryClient.resetQueries({ queryKey: conversationKeys.agentThread(ref.id) })
    return
  }
  void queryClient.resetQueries({ queryKey: ticketKeys.detail(ref.id) })
  void queryClient.resetQueries({ queryKey: ticketKeys.thread(ref.id) })
}
