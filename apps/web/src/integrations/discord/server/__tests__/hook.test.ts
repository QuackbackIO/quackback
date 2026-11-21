/**
 * Discord hook delivery with a stubbed transport: support notices post to the
 * configured channel, and a teammate reply posts nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventData } from '@/lib/server/events/types'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@/lib/server/integrations/sync/transport', () => ({
  integrationFetch: mocks.fetch,
}))

import { discordHook } from '../hook'

const target = { channelId: '123456' }
const config = { accessToken: 'bot-token', rootUrl: 'https://feedback.example.com' }

function messageCreated(senderType: 'visitor' | 'agent'): EventData {
  return {
    id: 'evt_1',
    timestamp: '2026-07-21T12:00:00.000Z',
    actor: { type: 'user', id: 'principal_1', name: 'Test User' },
    type: 'message.created',
    data: {
      message: {
        id: 'msg_1',
        conversationId: 'conv_123',
        senderType,
        authorPrincipalId: 'principal_2',
        authorName: 'Vera',
        authorEmail: 'vera@example.com',
        content: 'Still broken',
        createdAt: '2026-07-21T12:00:00.000Z',
      },
      conversation: { id: 'conv_123', status: 'open', channel: 'messenger', priority: 'none' },
      isFirstMessage: false,
    },
  } as EventData
}

beforeEach(() => {
  mocks.fetch.mockReset()
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'm_1' }), { status: 200 }))
})

describe('discordHook support events', () => {
  it('posts a customer message to the channel', async () => {
    const outcome = await discordHook.run(messageCreated('visitor'), target, config)
    expect(outcome).toEqual({ state: 'succeeded', result: { externalId: 'm_1' } })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://discord.com/api/v10/channels/123456/messages')
    expect(JSON.parse(init.body).embeds[0].description).toContain('Still broken')
  })

  it('posts nothing for a teammate reply', async () => {
    const outcome = await discordHook.run(messageCreated('agent'), target, config)
    expect(outcome).toEqual({ state: 'succeeded' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
