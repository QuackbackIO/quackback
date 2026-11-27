/**
 * Target resolution for the conversation-assignment EMAIL builder
 * (getConversationAssignedEmailTargets). Same recipients as the
 * bell: the new assignee and, on a team change, that team's members, never the
 * actor. Each recipient's "Conversation assigned" email preference applies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'
import type { HookContext } from '../hook-context'

// --- db: chainable select() consuming a FIFO of result rows ---
const selectQueue: unknown[][] = []
function queueSelect(rows: unknown[]): void {
  selectQueue.push(rows)
}
const mockSelect = vi.fn((..._args: unknown[]) => {
  const rows = selectQueue.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'limit', 'orderBy']) {
    chain[m] = () => chain
  }
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(res, rej)
  return chain
})

vi.mock('@/lib/server/domains/notifications/recipient-scope', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).recipientScopePassThrough()
)
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { select: (...args: unknown[]) => mockSelect(...args) },
}))

const batchGetNotificationPreferences = vi.fn<(ids: string[]) => Promise<Map<string, unknown>>>()
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  batchGetNotificationPreferences: (ids: string[]) => batchGetNotificationPreferences(ids),
}))

const listTeamMemberPrincipalIds = vi.fn<(teamId: string) => Promise<string[]>>()
vi.mock('@/lib/server/domains/teams', () => ({
  listTeamMemberPrincipalIds: (...a: [string]) => listTeamMemberPrincipalIds(...a),
}))

const { getConversationAssignedEmailTargets } = await import('../targets')

const context: HookContext = {
  portalBaseUrl: 'https://w.example',
  workspaceName: 'Acme Support',
  logoUrl: null,
}

beforeEach(() => {
  selectQueue.length = 0
  mockSelect.mockClear()
  batchGetNotificationPreferences.mockReset().mockResolvedValue(new Map())
  listTeamMemberPrincipalIds.mockReset().mockResolvedValue([])
})

function assignedEvent(data: {
  assignedAgentPrincipalId: string | null
  previousAgentPrincipalId?: string | null
  assignedTeamId?: string | null
  previousTeamId?: string | null
  actor?: string
}): EventData {
  return {
    id: 'evt-assigned',
    type: 'conversation.assigned',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: data.actor ?? 'principal_actor' },
    data: {
      conversation: {
        id: 'conversation_1',
        status: 'open',
        channel: 'messenger',
        priority: 'none',
      },
      assignedAgentPrincipalId: data.assignedAgentPrincipalId,
      previousAgentPrincipalId: data.previousAgentPrincipalId ?? null,
      assignedTeamId: data.assignedTeamId ?? null,
      previousTeamId: data.previousTeamId ?? null,
    },
  } as EventData
}

describe('getConversationAssignedEmailTargets', () => {
  it('emails the new assignee with an inbox link', async () => {
    queueSelect([{ id: 'principal_agent', email: 'agent@acme.test', contactEmail: null }])
    queueSelect([{ subject: 'Cannot log in', customerName: 'Jane' }])

    const targets = await getConversationAssignedEmailTargets(
      assignedEvent({ assignedAgentPrincipalId: 'principal_agent' }),
      context
    )

    expect(targets).toEqual([
      {
        type: 'email',
        target: { email: 'agent@acme.test', unsubscribeUrl: '', principalId: 'principal_agent' },
        config: {
          workspaceName: 'Acme Support',
          conversationId: 'conversation_1',
          customerName: 'Jane',
          preview: 'Cannot log in',
          ctaUrl: 'https://w.example/admin/inbox?i=conversation_1',
          logoUrl: undefined,
          preferencesUrl: 'https://w.example/settings/preferences',
          assignedToYou: true,
        },
      },
    ])
  })

  it('never emails the actor who assigned the conversation to themselves', async () => {
    const targets = await getConversationAssignedEmailTargets(
      assignedEvent({ assignedAgentPrincipalId: 'principal_actor' }),
      context
    )
    expect(targets).toEqual([])
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('emails nobody when the assignee did not change', async () => {
    const targets = await getConversationAssignedEmailTargets(
      assignedEvent({
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: 'principal_agent',
      }),
      context
    )
    expect(targets).toEqual([])
  })

  it('emails the members of a newly assigned team, minus the actor, as a team assignment', async () => {
    listTeamMemberPrincipalIds.mockResolvedValue(['principal_member', 'principal_actor'])
    queueSelect([{ id: 'principal_member', email: 'member@acme.test', contactEmail: null }])
    queueSelect([{ subject: null, customerName: null }])

    const targets = await getConversationAssignedEmailTargets(
      assignedEvent({ assignedAgentPrincipalId: null, assignedTeamId: 'team_1' }),
      context
    )

    expect(targets).toHaveLength(1)
    expect(targets[0].target).toMatchObject({ principalId: 'principal_member' })
    expect(targets[0].config).toMatchObject({ assignedToYou: false, preview: '' })
  })

  it('skips a teammate who switched conversation assignment emails off', async () => {
    queueSelect([{ id: 'principal_agent', email: 'agent@acme.test', contactEmail: null }])
    batchGetNotificationPreferences.mockResolvedValue(
      new Map<string, unknown>([
        ['principal_agent', { matrix: { conversation_assigned: { email: false } } }],
      ])
    )

    const targets = await getConversationAssignedEmailTargets(
      assignedEvent({ assignedAgentPrincipalId: 'principal_agent' }),
      context
    )
    expect(targets).toEqual([])
  })
})
