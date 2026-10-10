import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/db', () => ({
  db: {},
  eq: () => ({}),
  conversationMessages: { id: 'id' },
}))
vi.mock('../message.actions', () => ({
  broadcastInboxMessageUpdated: vi.fn(),
}))

import { isThreadAddressedChannel, pendingChannelDelivery } from '../conversation.channel-delivery'

describe('channel delivery helpers', () => {
  it('marks GitHub as thread-addressed and messenger/email as not', () => {
    expect(isThreadAddressedChannel('github')).toBe(true)
    expect(isThreadAddressedChannel('messenger')).toBe(false)
    expect(isThreadAddressedChannel('email')).toBe(false)
  })

  it('builds a pending stamp for a GitHub send', () => {
    const stamp = pendingChannelDelivery('github')
    expect(stamp).toMatchObject({ status: 'pending', channel: 'github' })
    expect(stamp.at).toEqual(expect.any(String))
  })
})
