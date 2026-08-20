import { describe, expect, it } from 'vitest'
import { resolveConversationRouting } from '../settings.conversation-routing'

describe('resolveConversationRouting', () => {
  it('prefers the metadata bag when the key is present', () => {
    const meta = JSON.stringify({
      conversationRouting: { enabled: true, strategy: 'auto_assign_active' },
    })
    const widget = JSON.stringify({
      messenger: { routing: { enabled: false, strategy: 'auto_assign_active' } },
    })
    expect(resolveConversationRouting(meta, widget)).toEqual({
      enabled: true,
      strategy: 'auto_assign_active',
    })
  })

  it('falls back to the released messenger.routing key', () => {
    const widget = JSON.stringify({
      messenger: { routing: { enabled: true, strategy: 'auto_assign_active' } },
    })
    expect(resolveConversationRouting(null, widget)).toEqual({
      enabled: true,
      strategy: 'auto_assign_active',
    })
  })

  it('defaults off when neither key is set', () => {
    expect(resolveConversationRouting(null, null)).toEqual({
      enabled: false,
      strategy: 'auto_assign_active',
    })
  })
})
