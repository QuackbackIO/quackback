import { describe, it, expect } from 'vitest'
import type { ConversationMessageId } from '@quackback/ids'
import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import { buildAdminChatRows } from '../admin-chat-rows'

const msg = (id: string) => ({ id }) as unknown as AgentConversationMessageDTO

describe('buildAdminChatRows', () => {
  it('returns an empty-state row when there are no messages', () => {
    const rows = buildAdminChatRows({
      messages: [],
      hasMoreOlder: false,
      firstUnreadId: null,
      showSeen: false,
      showTyping: false,
    })
    expect(rows.map((r) => r.type)).toEqual(['empty'])
  })

  it('prepends load-older and keys messages by id, in order', () => {
    const rows = buildAdminChatRows({
      messages: [msg('chat_msg_a'), msg('chat_msg_b')],
      hasMoreOlder: true,
      firstUnreadId: null,
      showSeen: false,
      showTyping: false,
    })
    expect(rows.map((r) => r.key)).toEqual(['load-older', 'chat_msg_a', 'chat_msg_b'])
  })

  it('inserts the unread divider immediately before the first unread message', () => {
    const rows = buildAdminChatRows({
      messages: [msg('m1'), msg('m2'), msg('m3')],
      hasMoreOlder: false,
      firstUnreadId: 'm2' as ConversationMessageId,
      showSeen: false,
      showTyping: false,
    })
    expect(rows.map((r) => r.key)).toEqual(['m1', 'unread', 'm2', 'm3'])
  })

  it('orders the full set: load-older, unread, messages, seen, typing', () => {
    const rows = buildAdminChatRows({
      messages: [msg('m1'), msg('m2')],
      hasMoreOlder: true,
      firstUnreadId: 'm1' as ConversationMessageId,
      showSeen: true,
      showTyping: true,
    })
    expect(rows.map((r) => r.key)).toEqual(['load-older', 'unread', 'm1', 'm2', 'seen', 'typing'])
  })
})
