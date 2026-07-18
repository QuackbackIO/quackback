/**
 * Target resolution for the watcher bells: getTicketRepliedTargets (all
 * watchers minus actor), getTicketNoteAddedTargets (agent watchers only —
 * the service's role-joined query keeps requester-watchers out structurally),
 * and getTicketStatusChangedTargets' requester ∪ watchers union. The
 * mute-precedence rule (a ticket-level mute wins regardless of the matrix)
 * is pinned here at the source: muted watchers never leave the service, so
 * they never reach the preference pass at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'

const getStageLabels = vi.fn<() => Promise<Record<string, string>>>()
vi.mock('@/lib/server/domains/settings/settings.tickets', () => ({
  getStageLabels: () => getStageLabels(),
}))

const getTicketWatchersForEvent = vi.fn<() => Promise<string[]>>()
const getTicketAgentWatchersForEvent = vi.fn<() => Promise<string[]>>()
vi.mock('@/lib/server/domains/tickets/ticket-subscription.service', () => ({
  getTicketWatchersForEvent: () => getTicketWatchersForEvent(),
  getTicketAgentWatchersForEvent: () => getTicketAgentWatchersForEvent(),
}))

const {
  getTicketRepliedTargets,
  getTicketNoteAddedTargets,
  getTicketStatusChangedTargets,
  getTicketExternalStatusChangedTargets,
} = await import('../targets')

beforeEach(() => {
  getStageLabels.mockReset()
  getStageLabels.mockResolvedValue({ received: 'Received', resolved: 'Resolved' })
  getTicketWatchersForEvent.mockReset()
  getTicketWatchersForEvent.mockResolvedValue([])
  getTicketAgentWatchersForEvent.mockReset()
  getTicketAgentWatchersForEvent.mockResolvedValue([])
})

const ticketRef = {
  id: 'ticket_1',
  number: 1,
  type: 'customer' as const,
  priority: 'none' as const,
}

function repliedEvent(overrides: Partial<Record<string, unknown>> = {}): EventData {
  return {
    id: 'evt-1',
    type: 'ticket.replied',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_actor' },
    data: {
      ticket: ticketRef,
      messageId: 'conversation_message_1',
      content: 'Thanks for the repro — fix is queued.',
      attachments: null,
      senderType: 'agent',
      title: 'Cannot log in',
      authorName: 'Sarah',
      requesterPrincipalId: 'principal_requester',
      ...overrides,
    },
  } as EventData
}

function noteEvent(overrides: Partial<Record<string, unknown>> = {}): EventData {
  return {
    id: 'evt-2',
    type: 'ticket.note_added',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_actor' },
    data: {
      ticket: ticketRef,
      messageId: 'conversation_message_2',
      content: 'Repro confirmed on staging.',
      attachments: null,
      senderType: 'agent',
      title: 'Cannot log in',
      authorName: 'Marco',
      ...overrides,
    },
  } as EventData
}

function statusEvent(overrides: Partial<Record<string, unknown>> = {}): EventData {
  return {
    id: 'evt-3',
    type: 'ticket.status_changed',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_actor' },
    data: {
      ticket: ticketRef,
      previousStatus: 'open',
      newStatus: 'closed',
      stage: 'resolved',
      previousStage: 'received',
      requesterPrincipalId: 'principal_requester',
      title: 'Cannot log in',
      ...overrides,
    },
  } as EventData
}

function externalStatusEvent(overrides: Partial<Record<string, unknown>> = {}): EventData {
  return {
    id: 'evt-4',
    type: 'ticket.external_status_changed',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'service', principalId: 'principal_integration' },
    data: {
      ticket: ticketRef,
      title: 'Cannot log in',
      integrationType: 'github',
      externalDisplayId: 'acme/app#412',
      externalUrl: 'https://github.com/acme/app/issues/412',
      externalStatus: 'Closed',
      transition: 'closed',
      ...overrides,
    },
  } as EventData
}

describe('getTicketExternalStatusChangedTargets', () => {
  it('resolves AGENT watchers only, with the link reference in config', async () => {
    getTicketAgentWatchersForEvent.mockResolvedValue(['principal_agent_1', 'principal_agent_2'])
    const target = await getTicketExternalStatusChangedTargets(externalStatusEvent())
    expect(getTicketWatchersForEvent).not.toHaveBeenCalled()
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_agent_1', 'principal_agent_2'] },
      config: {
        ticketId: 'ticket_1',
        title: 'Cannot log in',
        integrationType: 'github',
        reference: 'acme/app#412',
        url: 'https://github.com/acme/app/issues/412',
        externalStatus: 'Closed',
        transition: 'closed',
      },
    })
  })

  it('returns null when no agent watches the ticket', async () => {
    getTicketAgentWatchersForEvent.mockResolvedValue([])
    expect(await getTicketExternalStatusChangedTargets(externalStatusEvent())).toBeNull()
  })

  it('excludes the integration service principal if it somehow watches', async () => {
    getTicketAgentWatchersForEvent.mockResolvedValue(['principal_integration', 'principal_agent_1'])
    const target = await getTicketExternalStatusChangedTargets(externalStatusEvent())
    expect(target?.target).toEqual({ principalIds: ['principal_agent_1'] })
  })
})

describe('getTicketRepliedTargets', () => {
  it('resolves all watchers minus the actor into one target with preview config', async () => {
    getTicketWatchersForEvent.mockResolvedValue([
      'principal_requester',
      'principal_agent_1',
      'principal_actor',
    ])
    const target = await getTicketRepliedTargets(repliedEvent())
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_requester', 'principal_agent_1'] },
      config: {
        ticketId: 'ticket_1',
        title: 'Cannot log in',
        authorName: 'Sarah',
        preview: 'Thanks for the repro — fix is queued.',
        requesterPrincipalId: 'principal_requester',
      },
    })
  })

  it('a requester reply (visitor sender) bells the remaining watchers, actor excluded', async () => {
    getTicketWatchersForEvent.mockResolvedValue(['principal_requester', 'principal_agent_1'])
    const target = await getTicketRepliedTargets(
      repliedEvent({ senderType: 'visitor', authorName: null })
    )
    // The requester is the actor here.
    const event = repliedEvent({ senderType: 'visitor', authorName: null })
    ;(event as { actor: { principalId: string } }).actor.principalId = 'principal_requester'
    const actorExcluded = await getTicketRepliedTargets(event)
    expect(actorExcluded?.target).toEqual({ principalIds: ['principal_agent_1'] })
    expect(actorExcluded?.config).toMatchObject({ authorName: 'The requester' })
    expect(target?.target).toEqual({
      principalIds: ['principal_requester', 'principal_agent_1'],
    })
  })

  it('returns null with no watchers (mute precedence: muted watchers never leave the service)', async () => {
    expect(await getTicketRepliedTargets(repliedEvent())).toBeNull()
  })

  it('returns null for a non-replied event', async () => {
    expect(await getTicketRepliedTargets(statusEvent())).toBeNull()
  })
})

describe('getTicketNoteAddedTargets', () => {
  it('resolves agent watchers minus the actor; requester-watchers never appear (role-joined query)', async () => {
    getTicketAgentWatchersForEvent.mockResolvedValue(['principal_agent_1', 'principal_actor'])
    const target = await getTicketNoteAddedTargets(noteEvent())
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_agent_1'] },
      config: {
        ticketId: 'ticket_1',
        title: 'Cannot log in',
        authorName: 'Marco',
        preview: 'Repro confirmed on staging.',
      },
    })
    // The all-watchers lookup is never consulted — the agent-only query is the source.
    expect(getTicketWatchersForEvent).not.toHaveBeenCalled()
  })

  it('returns null when no agent watches (a requester-only watcher set stays silent)', async () => {
    getTicketAgentWatchersForEvent.mockResolvedValue([])
    expect(await getTicketNoteAddedTargets(noteEvent())).toBeNull()
  })

  it('returns null for a non-note event', async () => {
    expect(await getTicketNoteAddedTargets(repliedEvent())).toBeNull()
  })
})

describe('getTicketStatusChangedTargets (watchers union)', () => {
  it('unions requester and watchers minus the actor into ONE target', async () => {
    getTicketWatchersForEvent.mockResolvedValue([
      'principal_requester',
      'principal_agent_1',
      'principal_actor',
    ])
    const target = await getTicketStatusChangedTargets(statusEvent())
    const principalIds = (target?.target as { principalIds: string[] }).principalIds
    expect(principalIds).toHaveLength(2)
    expect(principalIds).toEqual(
      expect.arrayContaining(['principal_requester', 'principal_agent_1'])
    )
    expect(target?.config).toMatchObject({
      stageLabel: 'Resolved',
      requesterPrincipalId: 'principal_requester',
    })
  })

  it('a requester-less ticket with watchers still resolves (back-office parity)', async () => {
    getTicketWatchersForEvent.mockResolvedValue(['principal_agent_1'])
    const target = await getTicketStatusChangedTargets(statusEvent({ requesterPrincipalId: null }))
    expect(target?.target).toEqual({ principalIds: ['principal_agent_1'] })
    expect(target?.config).toMatchObject({ requesterPrincipalId: null })
  })

  it('null-stage and same-stage moves stay silent regardless of watchers', async () => {
    getTicketWatchersForEvent.mockResolvedValue(['principal_agent_1'])
    expect(await getTicketStatusChangedTargets(statusEvent({ stage: null }))).toBeNull()
    expect(
      await getTicketStatusChangedTargets(
        statusEvent({ stage: 'received', previousStage: 'received' })
      )
    ).toBeNull()
  })
})
