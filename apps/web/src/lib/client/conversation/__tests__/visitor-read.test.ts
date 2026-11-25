/**
 * A visitor's read changes the unread counts on every list and badge that
 * shows their conversations, on the widget and the portal alike, so all of
 * them refetch; queries unrelated to unread are left alone.
 */
import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { refreshVisitorUnreadCounts } from '../visitor-read'

describe('refreshVisitorUnreadCounts', () => {
  it('invalidates every visitor conversation list and unread badge, for any session', () => {
    const queryClient = new QueryClient()
    const seeded = [
      conversationKeys.widgetConversationList(1),
      conversationKeys.widgetConversationList(2),
      conversationKeys.widgetMessengerUnread(1),
      conversationKeys.portalConversationList(),
    ]
    const unrelated = ['widget', 'changelog']
    for (const key of [...seeded, unrelated]) queryClient.setQueryData(key, { seeded: true })

    refreshVisitorUnreadCounts(queryClient)

    for (const key of seeded) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    }
    expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false)
  })

  it('refetches the Home card even while Home is off screen, so going back never shows the old count', async () => {
    const queryClient = new QueryClient()
    const key = conversationKeys.widgetConversationSummary(1)
    const queryFn = vi.fn().mockResolvedValue({ conversation: null, teamName: null })
    await queryClient.fetchQuery({ queryKey: key, queryFn })
    queryFn.mockClear()

    refreshVisitorUnreadCounts(queryClient)

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
  })
})
