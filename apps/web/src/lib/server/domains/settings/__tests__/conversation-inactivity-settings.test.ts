import { describe, expect, it } from 'vitest'
import { resolveConversationInactivity } from '../settings.conversation-inactivity'
import { DEFAULT_CONVERSATION_INACTIVITY } from '@/lib/shared/conversation-inactivity'

describe('resolveConversationInactivity', () => {
  it('defaults to on, with the built-in windows', () => {
    expect(resolveConversationInactivity(null)).toEqual(DEFAULT_CONVERSATION_INACTIVITY)
    expect(resolveConversationInactivity('{}')).toEqual(DEFAULT_CONVERSATION_INACTIVITY)
  })

  it('preserves legacy shared choices while separating subsequent chat and email edits', () => {
    const resolved = resolveConversationInactivity(
      JSON.stringify({
        conversationInactivity: {
          assistant: { closeWhenAnswered: false, closingMessage: 'Legacy custom closing message' },
        },
      })
    )
    expect(resolved.assistant.email.closeWhenAnswered).toBe(false)
    expect(resolved.assistant.email.closingMessage).toBe('Legacy custom closing message')
    resolved.assistant.closeWhenAnswered = true
    resolved.assistant.closingMessage = 'New chat closing message'
    const saved = resolveConversationInactivity(
      JSON.stringify({ conversationInactivity: resolved })
    )
    expect(saved.assistant.email.closeWhenAnswered).toBe(false)
    expect(saved.assistant.email.closingMessage).toBe('Legacy custom closing message')
  })

  it('merges a stored section over defaults', () => {
    const meta = JSON.stringify({
      conversationInactivity: {
        messenger: { closeMinutes: 45 },
        assistant: { enabled: false },
      },
    })
    const resolved = resolveConversationInactivity(meta)
    expect(resolved.messenger.closeMinutes).toBe(45)
    expect(resolved.messenger.checkInMinutes).toBe(15)
    expect(resolved.assistant.enabled).toBe(false)
    expect(resolved.assistant.closeMinutes).toBe(15)
    expect(resolved.assistant.email).toMatchObject({ checkInHours: 24, closeHours: 72 })
    expect(resolved.email.closeHours).toBe(72)
  })

  it('fills assistant.email defaults when the stored blob omits them', () => {
    const meta = JSON.stringify({
      conversationInactivity: {
        assistant: { closeMinutes: 20 },
      },
    })
    const resolved = resolveConversationInactivity(meta)
    expect(resolved.assistant.closeMinutes).toBe(20)
    expect(resolved.assistant.email).toMatchObject({ checkInHours: 24, closeHours: 72 })
  })

  it('merges a partial assistant.email without dropping checkInHours', () => {
    const meta = JSON.stringify({
      conversationInactivity: {
        assistant: { email: { closeHours: 48 } },
      },
    })
    const resolved = resolveConversationInactivity(meta)
    expect(resolved.assistant.email.checkInHours).toBe(24)
    expect(resolved.assistant.email.closeHours).toBe(48)
  })

  it('falls back to defaults on unparseable metadata', () => {
    expect(resolveConversationInactivity('not json')).toEqual(DEFAULT_CONVERSATION_INACTIVITY)
  })

  it('ignores an invalid stored shape', () => {
    const meta = JSON.stringify({
      conversationInactivity: { messenger: { closeMinutes: 99999 } },
    })
    expect(resolveConversationInactivity(meta)).toEqual(DEFAULT_CONVERSATION_INACTIVITY)
  })
})
