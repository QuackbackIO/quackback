/**
 * Key-parity guard for the chat-inbox query factory. These keys MUST stay
 * byte-identical to the inline keys the inbox components and SSE cache writes
 * already use — a drift silently disables SSR hydration AND breaks
 * invalidation/optimistic writes, with no type error to catch it.
 */
import { describe, it, expect, vi } from 'vitest'
import type { ConversationTagId, SegmentId, ConversationId } from '@quackback/ids'

// Stub the server fns so importing the factory doesn't pull server-only code
// (config/env validation) into the test; we only assert on queryKey here.
vi.mock('@/lib/server/functions/conversation', () => ({
  listConversationsFn: vi.fn(),
  getConversationFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/conversation-tags', () => ({
  fetchConversationTagsWithCountsFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/chat-segments', () => ({ fetchInboxSegmentsWithCountsFn: vi.fn() }))

import { chatInboxQueries } from './chat-inbox'

const tagId = 'chat_tag_x' as ConversationTagId
const segId = 'segment_y' as SegmentId
const convId = 'conversation_z' as ConversationId

describe('chatInboxQueries key parity', () => {
  it('conversationList key matches the legacy inline list key', () => {
    expect(
      chatInboxQueries.conversationList({ kind: 'view', view: 'all' }, 'open', 'all', '').queryKey
    ).toEqual(['admin', 'inbox', 'conversations', 'view:all', 'open', 'all', ''])
    expect(
      chatInboxQueries.conversationList({ kind: 'tag', tagId }, 'closed', 'high', 'refund').queryKey
    ).toEqual(['admin', 'inbox', 'conversations', `tag:${tagId}`, 'closed', 'high', 'refund'])
    expect(
      chatInboxQueries.conversationList({ kind: 'segment', segmentId: segId }, 'open', 'all', '')
        .queryKey
    ).toEqual(['admin', 'inbox', 'conversations', `segment:${segId}`, 'open', 'all', ''])
  })

  it('thread key matches the legacy thread key', () => {
    expect(chatInboxQueries.thread(convId).queryKey).toEqual(['admin', 'inbox', 'thread', convId])
  })

  it('tagCounts key matches CHAT_TAG_COUNTS_KEY', () => {
    expect(chatInboxQueries.tagCounts().queryKey).toEqual(['admin', 'inbox', 'chat-tags', 'counts'])
  })

  it('segmentCounts key matches INBOX_SEGMENT_COUNTS_KEY', () => {
    expect(chatInboxQueries.segmentCounts().queryKey).toEqual([
      'admin',
      'inbox',
      'segments',
      'counts',
    ])
  })
})
