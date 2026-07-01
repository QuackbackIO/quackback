/**
 * visitorConversationLink: the one place that decides where a conversation
 * email deep-links to — the portal Support thread when that surface is on,
 * else the widget's ?c= deep link.
 */
import { describe, expect, it } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import { visitorConversationLink } from '../conversation.notify'

const id = 'conversation_abc123' as ConversationId

describe('visitorConversationLink', () => {
  it('links to the portal Support thread when portal support is enabled', () => {
    expect(visitorConversationLink('https://feedback.example.com', id, true)).toBe(
      'https://feedback.example.com/support/conversation_abc123'
    )
  })

  it('links to the widget deep link when portal support is disabled', () => {
    expect(visitorConversationLink('https://feedback.example.com', id, false)).toBe(
      'https://feedback.example.com/widget/?c=conversation_abc123'
    )
  })

  it('tolerates a trailing slash on the base URL', () => {
    expect(visitorConversationLink('https://feedback.example.com/', id, true)).toBe(
      'https://feedback.example.com/support/conversation_abc123'
    )
  })
})
