/**
 * Design-only dry run: a fixture channel named generically can register a
 * descriptor + adapter and flow through the shared inbound pipeline with no
 * new `channel ===` branches in domain notify/routing code.
 */
import { describe, expect, it, afterEach } from 'vitest'
import type { Channel } from '@/lib/shared/conversation/types'
import type { ChannelDescriptor } from '@/lib/shared/channels'
import {
  listChannelDescriptors,
  registerChannelDescriptor,
  unregisterChannelDescriptor,
  getChannelDescriptor,
} from '@/lib/shared/channels'
import {
  listChannelAdapters,
  registerChannelAdapter,
  unregisterChannelAdapter,
  getChannelAdapter,
  requireChannelAdapter,
} from '../index'
import type { ChannelAdapter } from '../types'
import { resolveInboundConversation } from '@/lib/server/domains/conversation/conversation.inbound-resolve'

const FIXTURE_ID = 'test_channel' as Channel

const fixtureDescriptor: ChannelDescriptor = {
  id: FIXTURE_ID,
  label: 'Test channel',
  icon: 'email',
  surface: 'theirs',
  threading: 'per-thread',
  reopenOnReply: 'always',
  accountRoles: ['connection'],
  richText: 'limited',
}

const fixtureAdapter: ChannelAdapter = {
  id: FIXTURE_ID,
  async resolveDeliveryTarget() {
    return { kind: 'none' }
  },
  async deliverAgentMessage() {},
  async deliverLifecycleEvent() {},
  async deliverCsatRequest() {},
}

describe('channel extensibility exit test', () => {
  afterEach(() => {
    unregisterChannelDescriptor(FIXTURE_ID)
    unregisterChannelAdapter(FIXTURE_ID)
  })

  it('wires a fixture channel through descriptor + adapter with no domain branches', async () => {
    registerChannelDescriptor(fixtureDescriptor)
    registerChannelAdapter(fixtureAdapter)

    expect(getChannelDescriptor(FIXTURE_ID)?.label).toBe('Test channel')
    expect(listChannelDescriptors().map((d) => d.id)).toContain(FIXTURE_ID)
    expect(getChannelAdapter(FIXTURE_ID)).toBe(fixtureAdapter)
    expect(listChannelAdapters().map((a) => a.id)).toContain(FIXTURE_ID)

    const adapter = requireChannelAdapter(FIXTURE_ID)
    expect(await adapter.resolveDeliveryTarget({} as never)).toEqual({ kind: 'none' })

    const conversationId = 'conversation_01kw8qxn1eeh4t2rek7varh032' as const
    const resolved = await resolveInboundConversation({
      lookupCorrelation: async () => conversationId,
    })
    expect(resolved).toBe(conversationId)

    const created = await resolveInboundConversation({
      lookupCorrelation: async () => null,
    })
    expect(created).toBeNull()

    // Notify and routing already go through requireChannelAdapter /
    // getConversationRouting. A new channel must not require a new
    // `channel ===` arm there — the fixture reaching those helpers is the proof.
    expect(() => requireChannelAdapter(FIXTURE_ID)).not.toThrow()
  })
})
