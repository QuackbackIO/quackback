/**
 * An agent-side read clears the conversation's unread badge in every cached
 * inbox list in place, and refetches a list only where a patch could be wrong.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { inboxKeys } from '@/lib/client/queries/inbox'
import { applyConversationReadToLists } from '../inbox-read'

const OPEN = 'conversation_01h00000000000000000000000' as ConversationId
const OTHER = 'conversation_01h00000000000000000000001' as ConversationId

function conversation(id: ConversationId, overrides: Partial<ConversationDTO> = {}) {
  return {
    id,
    lastMessageAt: '2026-07-02T10:00:00.000Z',
    unreadCount: 2,
    agentLastReadAt: null,
    ...overrides,
  } as ConversationDTO
}

function item(c: ConversationDTO): InboxItemDTO {
  return { kind: 'conversation', conversation: c, linkedTicket: null, searchSnippet: null }
}

const UNIFIED = inboxKeys.item('open|||')
const LEGACY = conversationKeys.agentConversationList('view:mine', 'open', 'all', '')

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(UNIFIED, {
    items: [item(conversation(OPEN)), item(conversation(OTHER))],
    cursor: null,
  })
  client.setQueryData(LEGACY, {
    conversations: [conversation(OPEN), conversation(OTHER)],
    hasMore: false,
    nextCursor: null,
  })
})

type Unified = { items: Extract<InboxItemDTO, { kind: 'conversation' }>[] }
type Legacy = { conversations: ConversationDTO[] }
const unified = () => client.getQueryData<Unified>(UNIFIED)!
const legacy = () => client.getQueryData<Legacy>(LEGACY)!

describe('applyConversationReadToLists', () => {
  it("clears the conversation's badge in every list and leaves other rows untouched", () => {
    const otherBefore = unified().items[1]
    const spy = vi.spyOn(client, 'invalidateQueries')

    applyConversationReadToLists(client, OPEN, '2026-07-02T10:00:01.000Z')

    expect(unified().items[0].conversation).toMatchObject({
      unreadCount: 0,
      agentLastReadAt: '2026-07-02T10:00:01.000Z',
    })
    expect(legacy().conversations[0]).toMatchObject({ unreadCount: 0 })
    expect(unified().items[1]).toBe(otherBefore)
    expect(legacy().conversations[1].unreadCount).toBe(2)
    expect(spy).not.toHaveBeenCalled()
  })

  it("clears the caller's own read without a watermark", () => {
    applyConversationReadToLists(client, OPEN)

    expect(unified().items[0].conversation.unreadCount).toBe(0)
    expect(legacy().conversations[0].unreadCount).toBe(0)
  })

  it('refetches a list whose row has a message newer than the watermark', () => {
    const spy = vi.spyOn(client, 'invalidateQueries')

    // A mark-unread moves the watermark back before the last message.
    applyConversationReadToLists(client, OPEN, '2026-07-01T00:00:00.000Z')

    expect(unified().items[0].conversation.unreadCount).toBe(2)
    expect(spy).toHaveBeenCalledWith({ queryKey: UNIFIED, exact: true })
    expect(spy).toHaveBeenCalledWith({ queryKey: LEGACY, exact: true })
  })

  it('refetches a list that is mid-fetch rather than patching a snapshot it may overwrite', async () => {
    let resolve!: (v: unknown) => void
    void client.fetchQuery({
      queryKey: UNIFIED,
      queryFn: () => new Promise((r) => (resolve = r)),
      staleTime: 0,
    })
    const spy = vi.spyOn(client, 'invalidateQueries')

    applyConversationReadToLists(client, OPEN, '2026-07-02T10:00:01.000Z')

    expect(spy).toHaveBeenCalledWith({ queryKey: UNIFIED, exact: true })
    expect(spy).not.toHaveBeenCalledWith({ queryKey: LEGACY, exact: true })
    resolve({ items: [], cursor: null })
  })

  it('leaves a list that is already clear as it is', () => {
    applyConversationReadToLists(client, OPEN, '2026-07-02T10:00:01.000Z')
    const before = client.getQueryData(UNIFIED)

    applyConversationReadToLists(client, OPEN, '2026-07-02T10:00:01.000Z')

    expect(client.getQueryData(UNIFIED)).toBe(before)
  })

  it('ignores a conversation no cached list holds', () => {
    const before = client.getQueryData(UNIFIED)
    const spy = vi.spyOn(client, 'invalidateQueries')

    applyConversationReadToLists(
      client,
      'conversation_01h00000000000000000000009' as ConversationId,
      '2026-07-02T10:00:01.000Z'
    )

    expect(client.getQueryData(UNIFIED)).toBe(before)
    expect(spy).not.toHaveBeenCalled()
  })
})
