import { describe, it, expect } from 'vitest'
import { buildChatRows } from '../conversation-rows'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'

// Only `id` matters for row keys; cast minimal stand-ins.
const msg = (
  idOrOpts: string | (Partial<ConversationMessageDTO> & { id?: string })
): ConversationMessageDTO => {
  if (typeof idOrOpts === 'string') return { id: idOrOpts } as unknown as ConversationMessageDTO
  return { id: 'msg-1', ...idOrOpts } as unknown as ConversationMessageDTO
}

const base = {
  messages: [] as ConversationMessageDTO[],
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

  it('routes system messages to system rows (still keyed by id)', () => {
    const sys = {
      id: 's1',
      senderType: 'system',
      content: 'Conversation assigned to Jane',
    } as unknown as ConversationMessageDTO
    const rows = buildChatRows({ ...base, messages: [msg('a'), sys] })
    expect(rows.map((r) => [r.type, r.key])).toEqual([
      ['message', 'a'],
      ['system', 's1'],
    ])
  })

  it('shows the empty row only when requested (no messages)', () => {
    expect(buildChatRows({ ...base, showEmpty: true }).map((r) => r.type)).toEqual(['empty'])
  })

  it('uses fixed, stable keys for the non-message rows', () => {
    const rows = buildChatRows({ ...base, hasGreeting: true, showTyping: true })
    expect(rows.map((r) => r.key)).toEqual(['greeting', 'typing'])
  })

  it('routes an embed message (contentJson) to a normal message row', () => {
    const m = msg({
      contentJson: {
        type: 'doc',
        content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: 'post_1' } }],
      } as any,
    })
    const rows = buildChatRows({ ...base, messages: [m] })
    expect(rows.filter((r) => r.type === 'message' && r.key === 'msg-1')).toHaveLength(1)
  })
})
