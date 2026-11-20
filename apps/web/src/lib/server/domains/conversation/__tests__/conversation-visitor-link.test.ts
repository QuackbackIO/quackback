/**
 * visitorConversationLink: the one place that decides where a conversation
 * email deep-links to — the portal Support thread when that surface is on,
 * else the widget's ?c= deep link.
 */
import { describe, expect, it } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import { visitorConversationLink } from '../conversation.notify'
import { allOnPrimary } from '@/lib/shared/section-links'

const id = 'conversation_abc123' as ConversationId
const onPrimary = allOnPrimary('https://feedback.example.com')
const onSupportHost = { ...onPrimary, support: 'https://support.acme.com' }

describe('visitorConversationLink', () => {
  it('links to the portal Support thread when portal support is enabled', () => {
    expect(visitorConversationLink(onPrimary, id, true)).toBe(
      'https://feedback.example.com/support/conversation_abc123'
    )
  })

  it("links to the Support thread on support's own host when it has one", () => {
    expect(visitorConversationLink(onSupportHost, id, true)).toBe(
      'https://support.acme.com/support/conversation_abc123'
    )
  })

  it('links to the widget deep link, on the primary domain, when portal support is disabled', () => {
    expect(visitorConversationLink(onSupportHost, id, false)).toBe(
      'https://feedback.example.com/widget/?c=conversation_abc123'
    )
  })

  it('tolerates a trailing slash on the base URL', () => {
    expect(visitorConversationLink(allOnPrimary('https://feedback.example.com/'), id, true)).toBe(
      'https://feedback.example.com/support/conversation_abc123'
    )
  })
})
