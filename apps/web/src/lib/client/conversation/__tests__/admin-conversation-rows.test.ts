import { describe, it, expect } from 'vitest'
import type { ConversationMessageId } from '@quackback/ids'
import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import { buildAdminConversationRows } from '../admin-conversation-rows'

const msg = (id: string) => ({ id }) as unknown as AgentConversationMessageDTO

describe('buildAdminConversationRows', () => {
  it('returns an empty-state row when there are no messages', () => {
    const rows = buildAdminConversationRows({
      messages: [],
      hasMoreOlder: false,
      firstUnreadId: null,
      showSeen: false,
      showTyping: false,
    })
    expect(rows.map((r) => r.type)).toEqual(['empty'])
  })

  it('prepends load-older and keys messages by id, in order', () => {
    const rows = buildAdminConversationRows({
      messages: [msg('conversation_msg_a'), msg('conversation_msg_b')],
      hasMoreOlder: true,
      firstUnreadId: null,
      showSeen: false,
      showTyping: false,
    })
    expect(rows.map((r) => r.key)).toEqual([
      'load-older',
      'conversation_msg_a',
      'conversation_msg_b',
    ])
  })

  it('inserts the unread divider immediately before the first unread message', () => {
    const rows = buildAdminConversationRows({
      messages: [msg('m1'), msg('m2'), msg('m3')],
      hasMoreOlder: false,
      firstUnreadId: 'm2' as ConversationMessageId,
      showSeen: false,
      showTyping: false,
    })
    expect(rows.map((r) => r.key)).toEqual(['m1', 'unread', 'm2', 'm3'])
  })

  it('orders the full set: load-older, unread, messages, seen, typing', () => {
    const rows = buildAdminConversationRows({
      messages: [msg('m1'), msg('m2')],
      hasMoreOlder: true,
      firstUnreadId: 'm1' as ConversationMessageId,
      showSeen: true,
      showTyping: true,
    })
    expect(rows.map((r) => r.key)).toEqual(['load-older', 'unread', 'm1', 'm2', 'seen', 'typing'])
  })

  // CF3: threads each message's derived block state through so
  // AgentMessageBubble can render an answered/superseded block as resolved
  // instead of always implying it's still live.
  describe('blockStates', () => {
    it('sets blockState from the map when a message id is present', () => {
      const rows = buildAdminConversationRows({
        messages: [msg('m1'), msg('m2')],
        hasMoreOlder: false,
        firstUnreadId: null,
        showSeen: false,
        showTyping: false,
        blockStates: new Map([
          ['m1', 'chosen'],
          ['m2', 'superseded'],
        ]),
      })
      const byKey = Object.fromEntries(
        rows.filter((r) => r.type === 'message').map((r) => [r.key, r.blockState])
      )
      expect(byKey).toEqual({ m1: 'chosen', m2: 'superseded' })
    })

    it('leaves blockState undefined for a message the map has no entry for', () => {
      const rows = buildAdminConversationRows({
        messages: [msg('m1')],
        hasMoreOlder: false,
        firstUnreadId: null,
        showSeen: false,
        showTyping: false,
        blockStates: new Map(),
      })
      expect(rows.find((r) => r.key === 'm1')).toMatchObject({ blockState: undefined })
    })

    it('leaves blockState undefined when no map is passed at all', () => {
      const rows = buildAdminConversationRows({
        messages: [msg('m1')],
        hasMoreOlder: false,
        firstUnreadId: null,
        showSeen: false,
        showTyping: false,
      })
      expect(rows.find((r) => r.key === 'm1')).toMatchObject({ blockState: undefined })
    })
  })
})
