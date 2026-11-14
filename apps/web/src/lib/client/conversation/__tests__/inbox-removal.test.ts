/**
 * An item that left the teammate's scope leaves every cached inbox list at
 * once, and its open thread or detail refetches so the pane shows not found.
 */
import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { ConversationId, TicketId } from '@quackback/ids'
import { removeInboxItemFromCaches } from '../inbox-removal'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { inboxKeys, ticketKeys } from '@/lib/client/queries/inbox'

const conv = (id: string) => ({ kind: 'conversation', conversation: { id } })
const ticket = (id: string) => ({ kind: 'ticket', ticket: { id } })

function seeded() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData([...inboxKeys.items(), 'mine'], {
    items: [conv('conversation_1'), ticket('ticket_1'), conv('conversation_2')],
    cursor: null,
  })
  qc.setQueryData([...inboxKeys.items(), 'team'], { items: [ticket('ticket_1')], cursor: 'c' })
  qc.setQueryData([...conversationKeys.agentConversations(), 'mine'], {
    conversations: [{ id: 'conversation_1' }, { id: 'conversation_2' }],
  })
  qc.setQueryData(conversationKeys.agentThread('conversation_1' as ConversationId), { x: 1 })
  qc.setQueryData(ticketKeys.detail('ticket_1' as TicketId), { id: 'ticket_1' })
  qc.setQueryData(ticketKeys.thread('ticket_1' as TicketId), { messages: [] })
  return qc
}

describe('removeInboxItemFromCaches', () => {
  it('takes a ticket out of every unified list and drops its cached detail and thread', () => {
    const qc = seeded()
    removeInboxItemFromCaches(qc, 'ticket', 'ticket_1')
    expect(qc.getQueryData<{ items: unknown[] }>([...inboxKeys.items(), 'mine'])?.items).toEqual([
      conv('conversation_1'),
      conv('conversation_2'),
    ])
    expect(qc.getQueryData<{ items: unknown[] }>([...inboxKeys.items(), 'team'])?.items).toEqual([])
    // Reset, not just invalidated: the ticket pane shows not found only once
    // its data is gone, and a failed refetch would keep the old data.
    expect(qc.getQueryData(ticketKeys.detail('ticket_1' as TicketId))).toBeUndefined()
    expect(qc.getQueryData(ticketKeys.thread('ticket_1' as TicketId))).toBeUndefined()
    // The other items are untouched.
    expect(
      qc.getQueryData(conversationKeys.agentThread('conversation_1' as ConversationId))
    ).toEqual({ x: 1 })
  })

  it('takes a conversation out of the unified and the conversation lists, and drops its thread', () => {
    const qc = seeded()
    removeInboxItemFromCaches(qc, 'conversation', 'conversation_1')
    expect(qc.getQueryData<{ items: unknown[] }>([...inboxKeys.items(), 'mine'])?.items).toEqual([
      ticket('ticket_1'),
      conv('conversation_2'),
    ])
    expect(
      qc.getQueryData<{ conversations: unknown[] }>([
        ...conversationKeys.agentConversations(),
        'mine',
      ])?.conversations
    ).toEqual([{ id: 'conversation_2' }])
    expect(
      qc.getQueryData(conversationKeys.agentThread('conversation_1' as ConversationId))
    ).toBeUndefined()
    expect(qc.getQueryData(ticketKeys.detail('ticket_1' as TicketId))).toEqual({ id: 'ticket_1' })
  })
})
