/**
 * Differential-coverage tests for ticket.query — the listTickets filter matrix
 * (inbox/org/contact null-vs-value, status ids/category, search, sort) and the
 * scope→permission gate in buildScopeWhere across every queue scope, including
 * the denied, degraded (no team), and invalid-scope branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const offsetMock = vi.fn()
  const tail: Record<string, unknown> = {
    orderBy: () => tail,
    limit: () => tail,
    offset: () => offsetMock(),
    then: (resolve: (v: unknown) => void) => resolve([{ count: 3 }]),
  }
  return {
    offsetMock,
    selectChain: { from: () => ({ where: () => tail }) },
    PERMISSIONS: {
      TICKET_VIEW_ALL: 'ticket.view_all',
      TICKET_VIEW_TEAM: 'ticket.view_team',
      TICKET_VIEW_ASSIGNED: 'ticket.view_assigned',
      TICKET_VIEW_SHARED: 'ticket.view_shared',
      INBOX_VIEW: 'inbox.view',
    },
  }
})

vi.mock('@/lib/server/db', () => ({
  db: { select: vi.fn(() => m.selectChain) },
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...a) => ({ and: a })),
  or: vi.fn((...a) => ({ or: a })),
  isNull: vi.fn((a) => ({ isNull: a })),
  inArray: vi.fn((a, b) => ({ inArray: [a, b] })),
  desc: vi.fn((a) => ({ desc: a })),
  asc: vi.fn((a) => ({ asc: a })),
  ilike: vi.fn((a, b) => ({ ilike: [a, b] })),
  sql: vi.fn((s) => ({ sql: s })),
  tickets: {
    id: 't.id',
    deletedAt: 't.deletedAt',
    inboxId: 't.inboxId',
    organizationId: 't.organizationId',
    requesterContactId: 't.requesterContactId',
    statusId: 't.statusId',
    subject: 't.subject',
    descriptionText: 't.descriptionText',
    createdAt: 't.createdAt',
    lastActivityAt: 't.lastActivityAt',
    assigneePrincipalId: 't.assigneePrincipalId',
    assigneeTeamId: 't.assigneeTeamId',
    primaryTeamId: 't.primaryTeamId',
  },
  ticketShares: { ticketId: 'ts.ticketId', teamId: 'ts.teamId', revokedAt: 'ts.revokedAt' },
  ticketStatuses: { id: 'tst.id', category: 'tst.category' },
  inboxMemberships: { inboxId: 'im.inboxId', principalId: 'im.principalId' },
}))

const PERMISSIONS = m.PERMISSIONS
vi.mock('../../authz', () => ({ PERMISSIONS: m.PERMISSIONS }))
vi.mock('../../authz/authz.service', () => ({
  hasPermission: (
    set: { workspacePermissions: Set<string>; teamPermissions: Map<string, Set<string>> },
    perm: string
  ) =>
    set.workspacePermissions.has(perm) ||
    [...set.teamPermissions.values()].some((s) => s.has(perm)),
}))

import { listTickets } from '../ticket.query'

const makeSet = (
  opts: {
    workspace?: string[]
    teams?: Record<string, string[]>
    teamIds?: string[]
    principalId?: string
  } = {}
) => ({
  principalId: (opts.principalId ?? 'p1') as never,
  teamIds: (opts.teamIds ?? []) as never,
  workspacePermissions: new Set(opts.workspace ?? []),
  teamPermissions: new Map(Object.entries(opts.teams ?? {}).map(([k, v]) => [k, new Set(v)])),
})

const list = (
  scope: string,
  set: ReturnType<typeof makeSet>,
  extra: Record<string, unknown> = {}
) => listTickets({ scope, permissionSet: set, ...extra } as never)

beforeEach(() => {
  vi.clearAllMocks()
  m.offsetMock.mockResolvedValue([{ id: 'ticket_1' }])
})

describe('listTickets filter matrix (scope=all)', () => {
  const all = () => makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ALL] })

  it('applies value filters, status ids, category, search, and created_desc sort', async () => {
    const res = await list('all', all(), {
      inboxId: 'inbox_1',
      organizationId: 'org_1',
      requesterContactId: 'contact_1',
      statusIds: ['st_1'],
      statusCategory: 'open',
      search: '  hello  ',
      sort: 'created_desc',
      limit: 9999,
      offset: -3,
    })
    expect(res).toEqual({ rows: [{ id: 'ticket_1' }], total: 3 })
  })

  it('applies null filters (inbox/org/contact null) and created_asc sort', async () => {
    const res = await list('all', all(), {
      inboxId: null,
      organizationId: null,
      requesterContactId: null,
      sort: 'created_asc',
    })
    expect(res.total).toBe(3)
  })

  it('runs with no optional filters and default sort', async () => {
    const res = await list('all', all())
    expect(res.total).toBe(3)
  })
})

describe('buildScopeWhere permission gates', () => {
  it('all: allowed with view_all, denied otherwise', async () => {
    await expect(
      list('all', makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ALL] }))
    ).resolves.toBeTruthy()
    await expect(list('all', makeSet())).rejects.toThrow('view_all')
  })

  it('my_assigned: allowed with view_assigned, denied without', async () => {
    await expect(
      list('my_assigned', makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ASSIGNED] }))
    ).resolves.toBeTruthy()
    await expect(list('my_assigned', makeSet())).rejects.toThrow('my_assigned')
  })

  it('my_team: team grant, workspace grant with no teams (degraded), and denied', async () => {
    await expect(
      list(
        'my_team',
        makeSet({ teams: { team_1: [PERMISSIONS.TICKET_VIEW_TEAM] }, teamIds: ['team_1'] })
      )
    ).resolves.toBeTruthy()
    // view_all but no team memberships -> degrades to false, still resolves
    await expect(
      list('my_team', makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ALL] }))
    ).resolves.toBeTruthy()
    await expect(list('my_team', makeSet())).rejects.toThrow('my_team')
  })

  it('shared_with_me: with teams, empty teams (false), and denied', async () => {
    await expect(
      list(
        'shared_with_me',
        makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_SHARED], teamIds: ['team_1'] })
      )
    ).resolves.toBeTruthy()
    await expect(
      list('shared_with_me', makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_SHARED] }))
    ).resolves.toBeTruthy()
    await expect(list('shared_with_me', makeSet())).rejects.toThrow('shared_with_me')
  })

  it('unassigned: view_all base, team-scoped, empty teams (false), and denied', async () => {
    await expect(
      list('unassigned', makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ALL] }))
    ).resolves.toBeTruthy()
    await expect(
      list(
        'unassigned',
        makeSet({ teams: { team_1: [PERMISSIONS.TICKET_VIEW_TEAM] }, teamIds: ['team_1'] })
      )
    ).resolves.toBeTruthy()
    await expect(
      list('unassigned', makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_TEAM] }))
    ).resolves.toBeTruthy()
    await expect(list('unassigned', makeSet())).rejects.toThrow('unassigned')
  })

  it('my_inbox: allowed with inbox.view, denied without', async () => {
    await expect(
      list('my_inbox', makeSet({ workspace: [PERMISSIONS.INBOX_VIEW] }))
    ).resolves.toBeTruthy()
    await expect(list('my_inbox', makeSet())).rejects.toThrow('my_inbox')
  })

  it('inbox: requires permission and an inboxId', async () => {
    await expect(
      list('inbox', makeSet({ workspace: [PERMISSIONS.INBOX_VIEW] }), { inboxId: 'inbox_1' })
    ).resolves.toBeTruthy()
    await expect(list('inbox', makeSet({ workspace: [PERMISSIONS.INBOX_VIEW] }))).rejects.toThrow(
      'inboxId is required'
    )
    await expect(list('inbox', makeSet())).rejects.toThrow('inbox.view')
  })

  it('rejects an unknown scope', async () => {
    await expect(
      list('bogus', makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ALL] }))
    ).rejects.toThrow('unknown scope')
  })
})
