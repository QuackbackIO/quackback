/**
 * Key-parity guard for the shared conversation key factory. These keys MUST
 * stay byte-identical to the inline keys the surfaces shipped with — a drift
 * silently breaks SSE cache writes, invalidations, and SSR hydration, with no
 * type error to catch it.
 */
import { describe, it, expect } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import { conversationKeys } from './conversation-keys'

const convId = 'conversation_z' as ConversationId

describe('conversationKeys parity', () => {
  it('admin keys match the legacy inline inbox keys', () => {
    expect(conversationKeys.agentConversations()).toEqual(['admin', 'inbox', 'conversations'])
    expect(conversationKeys.agentConversationList('view:all', 'open', 'all', '')).toEqual([
      'admin',
      'inbox',
      'conversations',
      'view:all',
      'open',
      'all',
      '',
    ])
    expect(conversationKeys.agentThread(convId)).toEqual(['admin', 'inbox', 'thread', convId])
    expect(conversationKeys.agentTagCounts()).toEqual([
      'admin',
      'inbox',
      'conversation-tags',
      'counts',
    ])
    expect(conversationKeys.agentSegmentCounts()).toEqual(['admin', 'inbox', 'segments', 'counts'])
    expect(conversationKeys.agentUserConversations()).toEqual([
      'admin',
      'inbox',
      'user-conversations',
    ])
    expect(conversationKeys.agentFlagged()).toEqual(['admin', 'inbox', 'flagged'])
    expect(conversationKeys.agentCannedReplies()).toEqual(['admin', 'inbox', 'canned'])
  })

  it('widget list key matches the legacy inline widget key', () => {
    expect(conversationKeys.widgetConversationList(3)).toEqual(['widget', 'my-conversations', 3])
  })

  it('portal list key matches PORTAL_MY_CONVERSATIONS_QUERY_KEY', () => {
    expect(conversationKeys.portalConversationList()).toEqual(['portal', 'my-conversations'])
  })

  it('visitor thread key is stable and null-safe', () => {
    expect(conversationKeys.visitorThread(convId)).toEqual([
      'conversation',
      'visitor-thread',
      convId,
    ])
    expect(conversationKeys.visitorThread(null)).toEqual(['conversation', 'visitor-thread', 'none'])
  })
})
