/**
 * Target resolution for the support-inbox assignment/hand-off bells (WO-3
 * slice 1): conversation.assigned, ticket.assigned, assistant.handed_off.
 * Each resolver is exported directly (like `webhookSubscriptionMatches`) so
 * these tests drive it without the rest of the getHookTargets pipeline
 * (cache, webhooks, integrations).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'

// db.select().from(conversations).where().limit(1) — only exercised by
// getAssistantHandedOffTargets, which re-reads the conversation's team.
let conversationRows: Array<{ assignedTeamId: string | null }> = []

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => conversationRows,
        }),
      }),
    }),
  },
}))

const listTeamMemberPrincipalIds = vi.fn<(teamId: string) => Promise<string[]>>()
const listAssignableTeammates =
  vi.fn<() => Promise<Array<{ principalId: string; name: string | null; email: string | null }>>>()

vi.mock('@/lib/server/domains/teams', () => ({
  listTeamMemberPrincipalIds: (...a: [string]) => listTeamMemberPrincipalIds(...a),
  listAssignableTeammates: () => listAssignableTeammates(),
}))

const { getConversationAssignedTargets, getTicketAssignedTargets, getAssistantHandedOffTargets } =
  await import('../targets')

beforeEach(() => {
  conversationRows = []
  listTeamMemberPrincipalIds.mockReset()
  listAssignableTeammates.mockReset()
})

const conversationRef = {
  id: 'conversation_1',
  status: 'open' as const,
  channel: 'messenger' as const,
  priority: 'none' as const,
}

describe('getConversationAssignedTargets', () => {
  it('targets the new assignee, excluding the actor', async () => {
    const event = {
      id: 'evt-1',
      type: 'conversation.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        conversation: conversationRef,
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: null,
        assignedTeamId: null,
        previousTeamId: null,
      },
    } as EventData

    const target = await getConversationAssignedTargets(event)
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_agent'] },
      config: { conversationId: 'conversation_1', assignedAgentPrincipalId: 'principal_agent' },
    })
  })

  it('is a no-op when the new assignee is the actor (never self-notify)', async () => {
    const event = {
      id: 'evt-2',
      type: 'conversation.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_agent' },
      data: {
        conversation: conversationRef,
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: null,
      },
    } as EventData

    expect(await getConversationAssignedTargets(event)).toBeNull()
  })

  it('is a no-op when unassigned (null agent)', async () => {
    const event = {
      id: 'evt-3',
      type: 'conversation.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        conversation: conversationRef,
        assignedAgentPrincipalId: null,
        previousAgentPrincipalId: 'principal_agent',
      },
    } as EventData

    expect(await getConversationAssignedTargets(event)).toBeNull()
  })

  it('is a no-op on a team-only reassignment (agent unchanged)', async () => {
    const event = {
      id: 'evt-4',
      type: 'conversation.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        conversation: conversationRef,
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: 'principal_agent',
      },
    } as EventData

    expect(await getConversationAssignedTargets(event)).toBeNull()
  })

  // WO-3 slice 2 (ported characterization): replaces the deleted
  // notifyTeamAssigned direct write (conversation.notify.ts). The type
  // deliberately changes from the old 'chat_message' to 'conversation_assigned'
  // — see notification-handler.test.ts's conversation.assigned describe block
  // for the title/type assertions once a target exists.
  it('unions the direct assignee with the newly-assigned team, excluding the actor, deduped', async () => {
    listTeamMemberPrincipalIds.mockResolvedValue([
      'principal_agent',
      'principal_teammate',
      'principal_actor',
    ])
    const event = {
      id: 'evt-4b',
      type: 'conversation.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        conversation: conversationRef,
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: null,
        assignedTeamId: 'team_1',
        previousTeamId: null,
      },
    } as EventData

    const target = await getConversationAssignedTargets(event)
    expect(listTeamMemberPrincipalIds).toHaveBeenCalledWith('team_1')
    // principal_agent appears once (deduped between direct assignee + team
    // member), principal_actor is excluded.
    expect(target?.target).toEqual({ principalIds: ['principal_agent', 'principal_teammate'] })
    expect(target?.config).toEqual({
      conversationId: 'conversation_1',
      assignedAgentPrincipalId: 'principal_agent',
    })
  })

  it('targets only the team when the agent is unchanged but the team is newly assigned', async () => {
    listTeamMemberPrincipalIds.mockResolvedValue(['principal_teammate', 'principal_actor'])
    const event = {
      id: 'evt-4c',
      type: 'conversation.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        conversation: conversationRef,
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: 'principal_agent',
        assignedTeamId: 'team_1',
        previousTeamId: null,
      },
    } as EventData

    const target = await getConversationAssignedTargets(event)
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_teammate'] },
      config: { conversationId: 'conversation_1', assignedAgentPrincipalId: null },
    })
  })

  it('is a no-op when the team is unchanged and the agent is unchanged', async () => {
    const event = {
      id: 'evt-4d',
      type: 'conversation.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        conversation: conversationRef,
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: 'principal_agent',
        assignedTeamId: 'team_1',
        previousTeamId: 'team_1',
      },
    } as EventData

    expect(await getConversationAssignedTargets(event)).toBeNull()
    expect(listTeamMemberPrincipalIds).not.toHaveBeenCalled()
  })
})

describe('getTicketAssignedTargets', () => {
  const ticketRef = {
    id: 'ticket_1',
    number: 1,
    type: 'customer' as const,
    priority: 'none' as const,
  }

  it('targets only the direct assignee when no team changed', async () => {
    const event = {
      id: 'evt-5',
      type: 'ticket.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        ticket: ticketRef,
        assignedPrincipalId: 'principal_agent',
        previousPrincipalId: null,
        assignedTeamId: null,
        previousTeamId: null,
      },
    } as EventData

    const target = await getTicketAssignedTargets(event)
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_agent'] },
      config: { ticketId: 'ticket_1', assignedPrincipalId: 'principal_agent' },
    })
    expect(listTeamMemberPrincipalIds).not.toHaveBeenCalled()
  })

  it('unions the direct assignee with the newly-assigned team, excluding the actor, deduped', async () => {
    listTeamMemberPrincipalIds.mockResolvedValue([
      'principal_agent',
      'principal_teammate',
      'principal_actor',
    ])
    const event = {
      id: 'evt-6',
      type: 'ticket.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        ticket: ticketRef,
        assignedPrincipalId: 'principal_agent',
        previousPrincipalId: null,
        assignedTeamId: 'team_1',
        previousTeamId: null,
      },
    } as EventData

    const target = await getTicketAssignedTargets(event)
    expect(listTeamMemberPrincipalIds).toHaveBeenCalledWith('team_1')
    // principal_agent appears once (deduped), principal_actor is excluded.
    expect(target?.target).toEqual({ principalIds: ['principal_agent', 'principal_teammate'] })
    expect(target?.config).toEqual({ ticketId: 'ticket_1', assignedPrincipalId: 'principal_agent' })
  })

  it('is a no-op when the assignee is unchanged and no team changed', async () => {
    const event = {
      id: 'evt-7',
      type: 'ticket.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        ticket: ticketRef,
        assignedPrincipalId: 'principal_agent',
        previousPrincipalId: 'principal_agent',
        assignedTeamId: 'team_1',
        previousTeamId: 'team_1',
      },
    } as EventData

    expect(await getTicketAssignedTargets(event)).toBeNull()
    expect(listTeamMemberPrincipalIds).not.toHaveBeenCalled()
  })

  it('never targets the actor as the direct assignee (never self-notify)', async () => {
    const event = {
      id: 'evt-8',
      type: 'ticket.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: 'principal_agent' },
      data: {
        ticket: ticketRef,
        assignedPrincipalId: 'principal_agent',
        previousPrincipalId: null,
        assignedTeamId: null,
        previousTeamId: null,
      },
    } as EventData

    expect(await getTicketAssignedTargets(event)).toBeNull()
  })
})

describe('getAssistantHandedOffTargets', () => {
  it("targets the assigned team's members when the conversation has one", async () => {
    conversationRows = [{ assignedTeamId: 'team_1' }]
    listTeamMemberPrincipalIds.mockResolvedValue(['principal_a', 'principal_quinn'])
    const event = {
      id: 'evt-9',
      type: 'assistant.handed_off',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'service', principalId: 'principal_quinn', displayName: 'Quinn' },
      data: { conversationId: 'conversation_1', reason: 'low confidence' },
    } as EventData

    const target = await getAssistantHandedOffTargets(event)
    expect(listTeamMemberPrincipalIds).toHaveBeenCalledWith('team_1')
    expect(listAssignableTeammates).not.toHaveBeenCalled()
    // Quinn (the actor) is excluded.
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_a'] },
      config: { conversationId: 'conversation_1', reason: 'low confidence' },
    })
  })

  it('falls back to every admin/member principal when the conversation has no team', async () => {
    conversationRows = [{ assignedTeamId: null }]
    listAssignableTeammates.mockResolvedValue([
      { principalId: 'principal_a', name: 'A', email: 'a@x.com' },
      { principalId: 'principal_b', name: 'B', email: 'b@x.com' },
    ])
    const event = {
      id: 'evt-10',
      type: 'assistant.handed_off',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'service', principalId: 'principal_quinn', displayName: 'Quinn' },
      data: { conversationId: 'conversation_1', reason: 'escalation requested' },
    } as EventData

    const target = await getAssistantHandedOffTargets(event)
    expect(listAssignableTeammates).toHaveBeenCalledTimes(1)
    expect(target?.target).toEqual({ principalIds: ['principal_a', 'principal_b'] })
  })

  it('is a no-op when the only eligible recipient is the actor', async () => {
    conversationRows = [{ assignedTeamId: null }]
    listAssignableTeammates.mockResolvedValue([
      { principalId: 'principal_quinn', name: 'Quinn', email: null },
    ])
    const event = {
      id: 'evt-11',
      type: 'assistant.handed_off',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'service', principalId: 'principal_quinn', displayName: 'Quinn' },
      data: { conversationId: 'conversation_1', reason: 'no one else around' },
    } as EventData

    expect(await getAssistantHandedOffTargets(event)).toBeNull()
  })
})
