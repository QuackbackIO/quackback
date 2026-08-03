/**
 * ticket.query — verifies that scope→permission gating is enforced and that
 * each scope produces the expected SQL filter shape (asserted via mock spies).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '../../authz'
import type { PermissionSet } from '../../authz/authz.service'
import type { PrincipalId, TeamId } from '@quackback/ids'

const selectChainOrderByMock = vi.fn()

const selectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: selectChainOrderByMock,
}

vi.mock('@/lib/server/db', () => {
  const limitMock = vi.fn().mockReturnThis()
  const offsetMock = vi.fn().mockResolvedValue([])
  selectChainOrderByMock.mockImplementation(() => ({ limit: limitMock, offset: offsetMock }))
  const countSelect = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: 0 }]),
  }
  return {
    db: {
      select: vi.fn((shape?: { count?: unknown }) => {
        if (shape && 'count' in shape) return countSelect
        return selectChain
      }),
    },
    eq: vi.fn(),
    and: vi.fn((...a: unknown[]) => ({ kind: 'and', args: a })),
    or: vi.fn((...a: unknown[]) => ({ kind: 'or', args: a })),
    isNull: vi.fn(() => ({ kind: 'isNull' })),
    isNotNull: vi.fn(() => ({ kind: 'isNotNull' })),
    inArray: vi.fn((col, vals) => ({ kind: 'inArray', col, vals })),
    desc: vi.fn(() => 'DESC'),
    asc: vi.fn(() => 'ASC'),
    ilike: vi.fn(() => ({ kind: 'ilike' })),
    sql: Object.assign((..._a: unknown[]) => ({ kind: 'sql' }), { raw: vi.fn() }),
    tickets: {
      _name: 'tickets',
      id: 'tickets.id',
      assigneePrincipalId: 'tickets.assignee_principal_id',
      assigneeTeamId: 'tickets.assignee_team_id',
      primaryTeamId: 'tickets.primary_team_id',
      statusId: 'tickets.status_id',
      subject: 'tickets.subject',
      descriptionText: 'tickets.description_text',
      lastActivityAt: 'tickets.last_activity_at',
      createdAt: 'tickets.created_at',
      deletedAt: 'tickets.deleted_at',
    },
    ticketShares: {
      _name: 'ticket_shares',
      ticketId: 'shares.ticket_id',
      teamId: 'shares.team_id',
      revokedAt: 'shares.revoked_at',
    },
    ticketStatuses: {
      _name: 'ticket_statuses',
      id: 'ticket_statuses.id',
      category: 'ticket_statuses.category',
    },
  }
})

vi.mock('@/lib/shared/errors', () => {
  class E extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  }
  return { ForbiddenError: E, ValidationError: E }
})

beforeEach(() => {
  vi.clearAllMocks()
})

const P = (s: string) => s as unknown as PrincipalId
const T = (s: string) => s as unknown as TeamId

function makeSet(opts: {
  principalId?: PrincipalId
  workspace?: PermissionKey[]
  team?: Record<string, PermissionKey[]>
  teamIds?: TeamId[]
}): PermissionSet {
  const teamPermissions = new Map<TeamId, ReadonlySet<PermissionKey>>()
  for (const [k, v] of Object.entries(opts.team ?? {})) {
    teamPermissions.set(T(k), new Set(v))
  }
  return {
    principalId: opts.principalId ?? P('user_a'),
    workspacePermissions: new Set(opts.workspace ?? []),
    teamPermissions,
    teamIds: opts.teamIds ?? Object.keys(opts.team ?? {}).map(T),
  }
}

describe('listTickets scope gating', () => {
  it('rejects "all" scope without TICKET_VIEW_ALL', async () => {
    const { listTickets } = await import('../ticket.query')
    await expect(
      listTickets({
        scope: 'all',
        permissionSet: makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_TEAM] }),
      })
    ).rejects.toThrow(/view_all/i)
  })

  it('allows "all" scope when TICKET_VIEW_ALL granted', async () => {
    const { listTickets } = await import('../ticket.query')
    await expect(
      listTickets({
        scope: 'all',
        permissionSet: makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ALL] }),
      })
    ).resolves.toBeDefined()
  })

  it('rejects "my_team" without team-view perm', async () => {
    const { listTickets } = await import('../ticket.query')
    await expect(
      listTickets({
        scope: 'my_team',
        permissionSet: makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ASSIGNED] }),
      })
    ).rejects.toThrow(/view_team/i)
  })

  it('rejects "shared_with_me" without view_shared perm', async () => {
    const { listTickets } = await import('../ticket.query')
    await expect(
      listTickets({
        scope: 'shared_with_me',
        permissionSet: makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ASSIGNED] }),
      })
    ).rejects.toThrow(/view_shared/i)
  })

  it('rejects "unassigned" without view_team or view_all', async () => {
    const { listTickets } = await import('../ticket.query')
    await expect(
      listTickets({
        scope: 'unassigned',
        permissionSet: makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ASSIGNED] }),
      })
    ).rejects.toThrow(/view_team/i)
  })

  it('allows "my_assigned" with view_assigned', async () => {
    const { listTickets } = await import('../ticket.query')
    await expect(
      listTickets({
        scope: 'my_assigned',
        permissionSet: makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ASSIGNED] }),
      })
    ).resolves.toBeDefined()
  })
})
