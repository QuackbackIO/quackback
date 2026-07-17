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
  getTicketRepliedTargets: vi.fn(),
  getTicketNoteAddedTargets: vi.fn(),
  getMessageCreatedTargets: vi.fn(),
  getTicketCreatedEmailTargets: vi.fn(),
  getTicketRepliedEmailTargets: vi.fn(),
  getTicketResolvedEmailTargets: vi.fn(),
  getTicketAssignedEmailTargets: vi.fn(),
  getSlaEmailTargets: vi.fn(),
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
  getTicketRepliedTargets: h.getTicketRepliedTargets,
  getTicketNoteAddedTargets: h.getTicketNoteAddedTargets,
  getMessageCreatedTargets: h.getMessageCreatedTargets,
  getTicketCreatedEmailTargets: h.getTicketCreatedEmailTargets,
  getTicketRepliedEmailTargets: h.getTicketRepliedEmailTargets,
  getTicketResolvedEmailTargets: h.getTicketResolvedEmailTargets,
  getTicketAssignedEmailTargets: h.getTicketAssignedEmailTargets,
  getSlaEmailTargets: h.getSlaEmailTargets,
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
    h.getTicketRepliedTargets.mockResolvedValue(T('ticket_replied_bell')[0])
    h.getTicketNoteAddedTargets.mockResolvedValue(T('ticket_note_bell')[0])
    h.getMessageCreatedTargets.mockResolvedValue(T('message_bell')[0])
    // Email builders return arrays; default empty so only the routed ones matter.
    h.getTicketCreatedEmailTargets.mockResolvedValue([])
    h.getTicketRepliedEmailTargets.mockResolvedValue([])
    h.getTicketResolvedEmailTargets.mockResolvedValue([])
    h.getTicketAssignedEmailTargets.mockResolvedValue([])
    h.getSlaEmailTargets.mockResolvedValue([])
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
    // ticket.created + SLA now route here for their email builders.
    expect(notificationResolver.interestedIn('ticket.created')).toBe(true)
    expect(notificationResolver.interestedIn('sla.approaching_breach')).toBe(true)
    expect(notificationResolver.interestedIn('sla.breached')).toBe(true)
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

  it('routes ticket.replied and ticket.note_added to the watcher bells', async () => {
    const replied = await notificationResolver.resolve(evt('ticket.replied'))
    expect(replied.map((t) => t.type)).toEqual(['ticket_replied_bell'])
    expect(h.getTicketRepliedTargets).toHaveBeenCalledTimes(1)

    const note = await notificationResolver.resolve(evt('ticket.note_added'))
    expect(note.map((t) => t.type)).toEqual(['ticket_note_bell'])
    expect(h.getTicketNoteAddedTargets).toHaveBeenCalledTimes(1)

    expect(notificationResolver.interestedIn('ticket.replied')).toBe(true)
    expect(notificationResolver.interestedIn('ticket.note_added')).toBe(true)
  })

  it('routes message.created to the new-message team bell', async () => {
    const out = await notificationResolver.resolve(evt('message.created'))
    expect(out.map((t) => t.type)).toEqual(['message_bell'])
    expect(h.getMessageCreatedTargets).toHaveBeenCalledTimes(1)
  })

  it('routes ticket.created to the email builder only (no bell for it)', async () => {
    h.getTicketCreatedEmailTargets.mockResolvedValue(T('created_email'))
    const out = await notificationResolver.resolve(evt('ticket.created'))
    expect(out.map((t) => t.type)).toEqual(['created_email'])
    expect(h.getTicketCreatedEmailTargets).toHaveBeenCalledTimes(1)
  })

  it('concats bell + email targets for ticket.replied', async () => {
    h.getTicketRepliedEmailTargets.mockResolvedValue([
      ...T('replied_email_a'),
      ...T('replied_email_b'),
    ])
    const out = await notificationResolver.resolve(evt('ticket.replied'))
    expect(out.map((t) => t.type)).toEqual([
      'replied_email_a',
      'replied_email_b',
      'ticket_replied_bell',
    ])
    expect(h.getTicketRepliedEmailTargets).toHaveBeenCalledTimes(1)
    expect(h.getTicketRepliedTargets).toHaveBeenCalledTimes(1)
  })

  it('concats bell + email targets for ticket.assigned', async () => {
    h.getTicketAssignedTargets.mockResolvedValue(T('assigned_bell')[0])
    h.getTicketAssignedEmailTargets.mockResolvedValue(T('assigned_email'))
    const out = await notificationResolver.resolve(evt('ticket.assigned'))
    expect(out.map((t) => t.type)).toEqual(['assigned_email', 'assigned_bell'])
  })

  it('routes SLA events to the SLA email builder', async () => {
    h.getSlaEmailTargets.mockResolvedValue(T('sla_email'))
    const warn = await notificationResolver.resolve(evt('sla.approaching_breach'))
    expect(warn.map((t) => t.type)).toEqual(['sla_email'])
    const breach = await notificationResolver.resolve(evt('sla.breached'))
    expect(breach.map((t) => t.type)).toEqual(['sla_email'])
    expect(h.getSlaEmailTargets).toHaveBeenCalledTimes(2)
  })

  it('builds the hook context exactly once per email-only resolve', async () => {
    h.getSlaEmailTargets.mockResolvedValue(T('sla_email'))
    await notificationResolver.resolve(evt('sla.breached'))
    expect(h.buildHookContext).toHaveBeenCalledTimes(1)
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
