import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/test-customer', () => ({}))
vi.mock('@/components/conversation/agent-conversation-thread', () => ({}))

import { roundTripSteps } from '../try-messenger-sheet'
import type { AgentThreadCache } from '@/components/conversation/events-reducer'

function thread(
  messages: Array<{ senderType: string; isAssistant?: boolean; isInternal?: boolean; at: string }>,
  visitorLastReadAt: string | null
) {
  return {
    conversation: { visitorLastReadAt },
    messages: messages.map((m) => ({
      senderType: m.senderType,
      isAssistant: m.isAssistant ?? false,
      isInternal: m.isInternal ?? false,
      createdAt: m.at,
    })),
  } as unknown as AgentThreadCache
}

describe('roundTripSteps', () => {
  it('starts with nothing done', () => {
    expect(roundTripSteps(null, undefined)).toEqual({ sent: false, replied: false, seen: false })
  })

  it('counts only a person replying in public, not the assistant or a note', () => {
    const t = thread(
      [
        { senderType: 'visitor', at: '2026-01-01T10:00:00Z' },
        { senderType: 'agent', isAssistant: true, at: '2026-01-01T10:00:05Z' },
        { senderType: 'agent', isInternal: true, at: '2026-01-01T10:00:10Z' },
      ],
      '2026-01-01T10:00:20Z'
    )
    expect(roundTripSteps('conversation_1', t)).toEqual({
      sent: true,
      replied: false,
      seen: false,
    })
  })

  it('finishes once the customer has read the latest reply', () => {
    const replied = [
      { senderType: 'visitor', at: '2026-01-01T10:00:00Z' },
      { senderType: 'agent', at: '2026-01-01T10:01:00Z' },
    ]
    expect(roundTripSteps('c', thread(replied, '2026-01-01T10:00:30Z')).seen).toBe(false)
    expect(roundTripSteps('c', thread(replied, '2026-01-01T10:01:00Z')).seen).toBe(true)
  })
})
