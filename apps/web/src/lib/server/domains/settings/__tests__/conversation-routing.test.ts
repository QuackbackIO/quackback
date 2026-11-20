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

  // RTE-04: the strategy is fixed; whatever a stored bag says, it reads back as
  // the one strategy the app has.
  it('reads any stored strategy back as auto_assign_active', () => {
    const meta = JSON.stringify({ conversationRouting: { enabled: true, strategy: 'round_robin' } })
    expect(resolveConversationRouting(meta, null)).toEqual({
      enabled: true,
      strategy: 'auto_assign_active',
    })
  })

  // RTE-05: once the card is saved, the metadata key wins over the legacy
  // messenger switch, including when the saved value is off.
  it('a saved metadata value of off wins over a legacy switch that is on', () => {
    const meta = JSON.stringify({
      conversationRouting: { enabled: false, strategy: 'auto_assign_active' },
    })
    const widget = JSON.stringify({ messenger: { routing: { enabled: true } } })
    expect(resolveConversationRouting(meta, widget)).toEqual({
      enabled: false,
      strategy: 'auto_assign_active',
    })
  })
})
