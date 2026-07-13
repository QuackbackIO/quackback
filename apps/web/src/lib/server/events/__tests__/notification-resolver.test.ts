import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the heavy targets.ts builders + hook context so this test covers the
// resolver's ROUTING (which builder fires for which type + concat), not the
// DB-backed builder internals (those keep their own tests in targets.*.test.ts).
const h = vi.hoisted(() => ({
  buildHookContext: vi.fn(),
  getSubscriberTargets: vi.fn(),
  getMentionTargets: vi.fn(),
  getChangelogSubscriberTargets: vi.fn(),
  getStatusSubscriberTargets: vi.fn(),
  getConversationAssignedTargets: vi.fn(),
  getTicketAssignedTargets: vi.fn(),
  getAssistantHandedOffTargets: vi.fn(),
  getConversationNoteMentionedTargets: vi.fn(),
  getTicketStatusChangedTargets: vi.fn(),
  getMessageCreatedTargets: vi.fn(),
}))
vi.mock('../hook-context', () => ({ buildHookContext: h.buildHookContext }))
vi.mock('../targets', () => ({
  SUBSCRIBER_EVENT_TYPES: ['post.status_changed', 'comment.created', 'changelog.published'],
  MENTION_EVENT_TYPES: ['post.mentioned'],
  getSubscriberTargets: h.getSubscriberTargets,
  getMentionTargets: h.getMentionTargets,
  getChangelogSubscriberTargets: h.getChangelogSubscriberTargets,
  getStatusSubscriberTargets: h.getStatusSubscriberTargets,
  getConversationAssignedTargets: h.getConversationAssignedTargets,
  getTicketAssignedTargets: h.getTicketAssignedTargets,
  getAssistantHandedOffTargets: h.getAssistantHandedOffTargets,
  getConversationNoteMentionedTargets: h.getConversationNoteMentionedTargets,
  getTicketStatusChangedTargets: h.getTicketStatusChangedTargets,
  getMessageCreatedTargets: h.getMessageCreatedTargets,
}))

import { createId } from '@quackback/ids'
import { notificationResolver } from '../resolvers/notification.resolver'
import type { DomainEvent } from '../envelope'

function evt(type: string): DomainEvent {
  return {
    eventId: createId('event'),
    seq: 1n,
    type,
    entityType: 'post',
    entityId: createId('post'),
    actorType: 'user',
    payload: {},
    context: { depth: 0 },
    schemaVersion: 1,
    occurredAt: new Date(),
  }
}
const T = (type: string) => [{ type, target: {}, config: {} }]

describe('notification resolver routing (WO-8c)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.buildHookContext.mockResolvedValue({ portalBaseUrl: 'https://p', workspaceName: 'W' })
    h.getSubscriberTargets.mockResolvedValue(T('subscriber'))
    h.getMentionTargets.mockResolvedValue(T('mention'))
    h.getChangelogSubscriberTargets.mockResolvedValue(T('changelog'))
    h.getStatusSubscriberTargets.mockResolvedValue(T('status'))
    h.getTicketStatusChangedTargets.mockResolvedValue(T('ticket_status_bell')[0])
    h.getMessageCreatedTargets.mockResolvedValue(T('message_bell')[0])
  })

  it('interestedIn covers subscriber, mention, status-publish, and bell types', () => {
    expect(notificationResolver.interestedIn('post.status_changed')).toBe(true)
    expect(notificationResolver.interestedIn('comment.created')).toBe(true)
    expect(notificationResolver.interestedIn('changelog.published')).toBe(true)
    expect(notificationResolver.interestedIn('post.mentioned')).toBe(true)
    expect(notificationResolver.interestedIn('status.incident_created')).toBe(true)
    // Bells relocated onto these events on `next` — must route here too.
    expect(notificationResolver.interestedIn('ticket.status_changed')).toBe(true)
    expect(notificationResolver.interestedIn('message.created')).toBe(true)
    expect(notificationResolver.interestedIn('post.created')).toBe(false)
    expect(notificationResolver.interestedIn('ticket.created')).toBe(false)
  })

  it('routes subscriber events to getSubscriberTargets', async () => {
    const out = await notificationResolver.resolve(evt('post.status_changed'))
    expect(out.map((t) => t.type)).toEqual(['subscriber'])
    expect(h.getChangelogSubscriberTargets).not.toHaveBeenCalled()
  })

  it('routes changelog.published to the changelog builder, not the generic one', async () => {
    const out = await notificationResolver.resolve(evt('changelog.published'))
    expect(out.map((t) => t.type)).toEqual(['changelog'])
    expect(h.getSubscriberTargets).not.toHaveBeenCalled()
  })

  it('routes post.mentioned to the mention builder', async () => {
    const out = await notificationResolver.resolve(evt('post.mentioned'))
    expect(out.map((t) => t.type)).toEqual(['mention'])
  })

  it('routes status publishes to the status builder', async () => {
    const out = await notificationResolver.resolve(evt('status.maintenance_scheduled'))
    expect(out.map((t) => t.type)).toEqual(['status'])
  })

  it('routes ticket.status_changed to the ticket requester bell', async () => {
    const out = await notificationResolver.resolve(evt('ticket.status_changed'))
    expect(out.map((t) => t.type)).toEqual(['ticket_status_bell'])
    expect(h.getTicketStatusChangedTargets).toHaveBeenCalledTimes(1)
  })

  it('routes message.created to the new-message team bell', async () => {
    const out = await notificationResolver.resolve(evt('message.created'))
    expect(out.map((t) => t.type)).toEqual(['message_bell'])
    expect(h.getMessageCreatedTargets).toHaveBeenCalledTimes(1)
  })

  it('drops a bell that resolves to no recipient (builder returns null)', async () => {
    h.getMessageCreatedTargets.mockResolvedValue(null)
    expect(await notificationResolver.resolve(evt('message.created'))).toEqual([])
  })

  it('fails resolution when no hook context can be built so the relay retries', async () => {
    h.buildHookContext.mockResolvedValue(null)
    await expect(notificationResolver.resolve(evt('post.status_changed'))).rejects.toThrow(
      'Failed to build notification hook context'
    )
  })
})
