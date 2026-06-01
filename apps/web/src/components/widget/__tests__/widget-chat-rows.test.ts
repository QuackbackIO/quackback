import { describe, it, expect } from 'vitest'
import { buildChatRows } from '../widget-chat-rows'
import type { ChatMessageDTO } from '@/lib/shared/chat/types'

// Only `id` matters for row keys; cast minimal stand-ins.
const msg = (id: string): ChatMessageDTO => ({ id }) as unknown as ChatMessageDTO

const base = {
  messages: [] as ChatMessageDTO[],
  hasMoreOlder: false,
  hasGreeting: false,
  showEmpty: false,
  showSeen: false,
  showTyping: false,
  showCsat: false,
}

describe('buildChatRows', () => {
  it('returns no rows for an empty, flag-less thread', () => {
    expect(buildChatRows(base)).toEqual([])
  })

  it('keys message rows by message id, in order', () => {
    const rows = buildChatRows({ ...base, messages: [msg('a'), msg('b'), msg('c')] })
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'c'])
    expect(rows.every((r) => r.type === 'message')).toBe(true)
  })

  it('orders load-older, greeting, messages, then trailing seen/typing/csat', () => {
    const rows = buildChatRows({
      messages: [msg('m1')],
      hasMoreOlder: true,
      hasGreeting: true,
      showEmpty: false,
      showSeen: true,
      showTyping: true,
      showCsat: true,
    })
    expect(rows.map((r) => r.key)).toEqual([
      'load-older',
      'greeting',
      'm1',
      'seen',
      'typing',
      'csat',
    ])
  })

  it('shows the empty row only when requested (no messages)', () => {
    expect(buildChatRows({ ...base, showEmpty: true }).map((r) => r.type)).toEqual(['empty'])
  })

  it('uses fixed, stable keys for the non-message rows', () => {
    const rows = buildChatRows({ ...base, hasGreeting: true, showTyping: true })
    expect(rows.map((r) => r.key)).toEqual(['greeting', 'typing'])
  })
})
