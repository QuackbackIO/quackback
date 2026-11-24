/**
 * Slack hook delivery with a stubbed Slack client: support notices are posted
 * to the configured channel, and an agent reply posts nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventData } from '@/lib/server/events/types'

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  join: vi.fn(),
  tokens: [] as string[],
}))

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    chat = { postMessage: mocks.postMessage }
    conversations = { join: mocks.join }
    constructor(token: string) {
      mocks.tokens.push(token)
    }
  },
}))
vi.mock('@/lib/server/integrations/sync/transport', () => ({
  recordDeliveryOutcome: vi.fn(),
}))
const hold = vi.hoisted(() => ({ supportAlertHold: vi.fn() }))
vi.mock('@/lib/server/integrations/support-alerts', () => hold)

import { slackHook } from '../hook'

const ROOT_URL = 'https://feedback.example.com'
const target = { channelId: 'C_SUPPORT' }
const config = { accessToken: 'xoxb-test', rootUrl: ROOT_URL, integrationId: 'integration_1' }

const envelope = {
  id: 'evt_1',
  timestamp: '2026-07-21T12:00:00.000Z',
  actor: { type: 'user' as const, id: 'principal_1', name: 'Test User' },
}
const conversationRef = {
  id: 'conv_123',
  status: 'open' as const,
  channel: 'messenger' as const,
  priority: 'none' as const,
}

function conversationCreated(): EventData {
  return {
    ...envelope,
    type: 'conversation.created',
    data: {
      conversation: {
        ...conversationRef,
        subject: 'Cannot log in',
        visitorPrincipalId: 'principal_2',
        visitorEmail: 'vera@example.com',
        assignedAgentPrincipalId: null,
        createdAt: '2026-07-21T12:00:00.000Z',
        lastMessageAt: '2026-07-21T12:00:00.000Z',
        resolvedAt: null,
      },
    },
  } as EventData
}

function messageCreated(senderType: 'visitor' | 'agent'): EventData {
  return {
    ...envelope,
    type: 'message.created',
    data: {
      message: {
        id: 'msg_1',
        conversationId: 'conv_123',
        senderType,
        authorPrincipalId: 'principal_2',
        authorName: 'Vera',
        authorEmail: 'vera@example.com',
        content: '<p>Still stuck</p>',
        createdAt: '2026-07-21T12:00:00.000Z',
      },
      conversation: conversationRef,
      isFirstMessage: false,
    },
  } as EventData
}

beforeEach(() => {
  mocks.postMessage.mockReset().mockResolvedValue({ ok: true, ts: '1700000000.0001' })
  mocks.join.mockReset()
  mocks.tokens.length = 0
  hold.supportAlertHold.mockReset().mockResolvedValue(null)
})

describe('slackHook support notices', () => {
  it('posts a new support conversation to the configured channel with an inbox link', async () => {
    const outcome = await slackHook.run(conversationCreated(), target, config)

    expect(outcome).toEqual({ state: 'succeeded', result: { externalId: '1700000000.0001' } })
    expect(mocks.tokens).toEqual(['xoxb-test'])
    expect(mocks.postMessage).toHaveBeenCalledTimes(1)
    const posted = mocks.postMessage.mock.calls[0][0]
    expect(posted.channel).toBe('C_SUPPORT')
    expect(posted.text).toBe('New support conversation from vera@example.com')
    expect(JSON.stringify(posted.blocks)).toContain(`${ROOT_URL}/admin/inbox?c=conv_123`)
  })

  it('posts a visitor message to the channel', async () => {
    await slackHook.run(messageCreated('visitor'), target, config)
    expect(mocks.postMessage).toHaveBeenCalledTimes(1)
    expect(mocks.postMessage.mock.calls[0][0].channel).toBe('C_SUPPORT')
  })

  it('posts nothing for an agent reply', async () => {
    const outcome = await slackHook.run(messageCreated('agent'), target, config)
    expect(outcome).toEqual({ state: 'succeeded' })
    expect(mocks.postMessage).not.toHaveBeenCalled()
  })

  it('posts nothing while the support check holds the message back', async () => {
    hold.supportAlertHold.mockResolvedValue('assignee_online')
    const event = messageCreated('visitor')
    const outcome = await slackHook.run(event, target, config)
    expect(outcome).toEqual({ state: 'succeeded' })
    expect(mocks.postMessage).not.toHaveBeenCalled()
    expect(hold.supportAlertHold).toHaveBeenCalledWith(event, {
      integrationId: 'integration_1',
      channelId: 'C_SUPPORT',
    })
  })
})
