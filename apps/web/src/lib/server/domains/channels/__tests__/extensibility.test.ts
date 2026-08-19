/**
 * Design-only dry run: a fixture channel named `test_channel` (tests only)
 * registers a descriptor + adapter and flows through inbox filter parsing
 * and domain notify without a new `channel ===` arm in those modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ChannelDescriptor } from '@/lib/shared/channels'
import {
  listChannelDescriptors,
  registerChannelDescriptor,
  unregisterChannelDescriptor,
  getChannelDescriptor,
  parseChannel,
} from '@/lib/shared/channels'
import { inboxChannelFilterSchema } from '@/lib/shared/channels/inbox-filter'
import {
  TEST_CHANNEL_ID,
  testChannelDescriptor,
} from '@/lib/shared/channels/__tests__/test-channel.fixture'
import {
  buildInboxListParams,
  buildListParams,
  normalizeInboxChannel,
} from '@/lib/client/conversation/inbox-scope'
import {
  listChannelAdapters,
  registerChannelAdapter,
  unregisterChannelAdapter,
  getChannelAdapter,
  requireChannelAdapter,
} from '../index'
import type { ChannelAdapter } from '../types'
import { resolveInboundConversation } from '@/lib/server/domains/conversation/conversation.inbound-resolve'

const hoisted = vi.hoisted(() => ({
  deliverAgentMessage: vi.fn(async (_opts: unknown) => {}),
  deliverLifecycleEvent: vi.fn(async () => {}),
  deliverCsatRequest: vi.fn(async (_opts: unknown) => {}),
  buildHookContext: vi.fn(async () => ({
    workspaceName: 'Acme',
    portalBaseUrl: 'https://acme.example.com',
    logoUrl: null as string | null,
  })),
  mintCsatEmailToken: vi.fn(() => 'csat-token'),
}))

function fixtureAdapter(): ChannelAdapter {
  return {
    id: TEST_CHANNEL_ID,
    async resolveDeliveryTarget() {
      return { kind: 'none' }
    },
    deliverAgentMessage: hoisted.deliverAgentMessage,
    deliverLifecycleEvent: hoisted.deliverLifecycleEvent,
    deliverCsatRequest: hoisted.deliverCsatRequest,
  }
}

let visitorRows: Array<Record<string, unknown>> = []
let limitQueue: Array<Record<string, unknown>[]> = []

vi.mock('@/lib/server/realtime/presence', () => ({
  isAnyAgentOnline: async () => false,
  isPrincipalOnline: async () => false,
}))

vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: () => hoisted.buildHookContext(),
}))

vi.mock('@/lib/server/domains/conversation/conversation-participant.service', () => ({
  listParticipantReplyRecipients: async () => [],
}))

vi.mock('@/lib/server/domains/conversation/csat-email-token', () => ({
  mintCsatEmailToken: () => hoisted.mintCsatEmailToken(),
}))

vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isPortalSupportEnabled: async () => false,
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.leftJoin = () => c
    c.where = () => c
    c.orderBy = () => c
    c.limit = async () => (limitQueue.length ? limitQueue.shift()! : visitorRows)
    c.then = (resolve: (v: unknown) => unknown) => resolve([])
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: { select: () => chain() },
  }
})

import {
  notifyAgentReply,
  notifyCsatRequestEmail,
} from '@/lib/server/domains/conversation/conversation.notify'

const conversationId = 'conversation_01kw8qxn1eeh4t2rek7varh032' as ConversationId
const visitorPrincipalId = 'principal_01kw8qxn1eeh4t2rek7varh033' as PrincipalId

describe('channel extensibility exit test', () => {
  beforeEach(() => {
    visitorRows = []
    limitQueue = []
    vi.clearAllMocks()
    registerChannelDescriptor(testChannelDescriptor)
    registerChannelAdapter(fixtureAdapter())
  })

  afterEach(() => {
    unregisterChannelDescriptor(TEST_CHANNEL_ID)
    unregisterChannelAdapter(TEST_CHANNEL_ID)
  })

  it('wires a fixture channel through descriptor + adapter with no domain branches', async () => {
    expect(getChannelDescriptor(TEST_CHANNEL_ID)?.label).toBe('Test channel')
    expect(listChannelDescriptors().map((d) => d.id)).toContain(TEST_CHANNEL_ID)
    expect(getChannelAdapter(TEST_CHANNEL_ID)?.id).toBe(TEST_CHANNEL_ID)
    expect(listChannelAdapters().map((a) => a.id)).toContain(TEST_CHANNEL_ID)

    const adapter = requireChannelAdapter(TEST_CHANNEL_ID)
    expect(await adapter.resolveDeliveryTarget({} as never)).toEqual({ kind: 'none' })

    const resolved = await resolveInboundConversation({
      lookupCorrelation: async () => conversationId,
    })
    expect(resolved).toBe(conversationId)

    const created = await resolveInboundConversation({
      lookupCorrelation: async () => null,
    })
    expect(created).toBeNull()

    expect(() => requireChannelAdapter(TEST_CHANNEL_ID)).not.toThrow()
  })

  it('inbox filter options and validation accept the fixture without a new branch', () => {
    expect(parseChannel(TEST_CHANNEL_ID)).toBe(TEST_CHANNEL_ID)
    expect(normalizeInboxChannel(TEST_CHANNEL_ID)).toBe(TEST_CHANNEL_ID)
    expect(inboxChannelFilterSchema.parse(TEST_CHANNEL_ID)).toBe(TEST_CHANNEL_ID)
    expect(listChannelDescriptors().some((d: ChannelDescriptor) => d.id === TEST_CHANNEL_ID)).toBe(
      true
    )

    expect(
      buildListParams(
        { kind: 'view', view: 'all' },
        'open',
        'all',
        '',
        undefined,
        undefined,
        undefined,
        undefined,
        TEST_CHANNEL_ID
      )
    ).toMatchObject({ channel: TEST_CHANNEL_ID })
    expect(
      buildInboxListParams(
        { kind: 'view', view: 'all' },
        'open',
        'all',
        '',
        undefined,
        undefined,
        undefined,
        undefined,
        TEST_CHANNEL_ID
      )
    ).toMatchObject({ channel: TEST_CHANNEL_ID })
  })

  it('notify delivers through the fixture adapter without a new channel arm', async () => {
    visitorRows = [{ type: 'user', email: 'priya@example.com', contactEmail: null }]

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'reply',
      agentName: 'Alex',
      channel: TEST_CHANNEL_ID,
    })

    expect(hoisted.deliverAgentMessage).toHaveBeenCalledTimes(1)
    expect(hoisted.deliverAgentMessage.mock.calls[0][0]).toMatchObject({
      conversationId,
      visitorPrincipalId,
      recipient: 'priya@example.com',
      direction: 'agent_reply',
    })

    limitQueue = [
      [{ channel: TEST_CHANNEL_ID, visitorPrincipalId }],
      [{ type: 'user', email: 'priya@example.com', contactEmail: null }],
    ]
    await notifyCsatRequestEmail(conversationId, 'How did we do?')
    expect(hoisted.deliverCsatRequest).toHaveBeenCalledTimes(1)
    expect(hoisted.deliverCsatRequest.mock.calls[0][0]).toMatchObject({
      conversationId,
      visitorPrincipalId,
      recipient: 'priya@example.com',
    })

    await requireChannelAdapter(TEST_CHANNEL_ID).deliverLifecycleEvent('closed', {
      conversationId,
    })
    expect(hoisted.deliverLifecycleEvent).toHaveBeenCalledWith('closed', { conversationId })
  })
})
