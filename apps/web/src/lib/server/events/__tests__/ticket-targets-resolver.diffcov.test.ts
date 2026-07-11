/**
 * Differential-coverage tests for getTicketEmailTargets — the recipient
 * resolver: per-category candidate building (thread public/internal, status,
 * assignment, participants, shares, sla, properties), actor suppression,
 * canView + sibling-principal fallback (+cache/catch), notification-preference
 * filtering, and the email/eligibility short-circuits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const selectWhere = vi.fn()
  const chain: Record<string, unknown> = { where: () => selectWhere(), innerJoin: () => chain }
  return {
    selectWhere,
    chain,
    getSubscribers: vi.fn(),
    resolvePortalLinked: vi.fn(),
    resolvePrincipalsForContacts: vi.fn(),
    canViewTicket: vi.fn(),
    toResourceScope: vi.fn(),
    loadPermissionSet: vi.fn(),
    batchGetPrefs: vi.fn(),
    batchGenTokens: vi.fn(),
  }
})

vi.mock('@/lib/server/db', () => ({
  db: { select: () => ({ from: () => m.chain }) },
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  ticketShares: {},
  teamMemberships: { principalId: 'tm.principalId', teamId: 'tm.teamId' },
  principal: { id: 'pr.id', userId: 'pr.userId' },
  user: { id: 'u.id', email: 'u.email' },
}))
vi.mock('../../domains/tickets/ticket.subscriptions', () => ({
  getSubscribers: (...a: unknown[]) => m.getSubscribers(...a),
}))
vi.mock('../../domains/tickets/ticket.recipients', () => ({
  resolvePortalLinkedRecipients: (...a: unknown[]) => m.resolvePortalLinked(...a),
  resolvePrincipalsForContacts: (...a: unknown[]) => m.resolvePrincipalsForContacts(...a),
}))
vi.mock('../../domains/tickets/ticket.permissions', () => ({
  canViewTicket: (...a: unknown[]) => m.canViewTicket(...a),
  toResourceScope: (...a: unknown[]) => m.toResourceScope(...a),
}))
vi.mock('../../domains/authz/authz.service', () => ({
  loadPermissionSet: (...a: unknown[]) => m.loadPermissionSet(...a),
}))
vi.mock('../../domains/subscriptions/subscription.service', () => ({
  batchGetNotificationPreferences: (...a: unknown[]) => m.batchGetPrefs(...a),
  batchGenerateUnsubscribeTokens: (...a: unknown[]) => m.batchGenTokens(...a),
}))

import { getTicketEmailTargets } from '../ticket-targets'

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 'ticket_1',
  subject: 'Help',
  descriptionText: 'desc',
  statusName: 'Open',
  statusCategory: 'open',
  priority: 'high',
  requesterPrincipalId: null,
  requesterContactId: null,
  assigneePrincipalId: null,
  assigneeTeamId: null,
  primaryTeamId: null,
  ...over,
})
const ev = (
  type: string,
  data: Record<string, unknown> = {},
  actorPrincipalId: string | null = null
) => ({
  type,
  data: { ticket: ticket(), ...data },
  actor: { principalId: actorPrincipalId, displayName: 'Actor', email: 'actor@x.test' },
  timestamp: '2026-02-02T10:00:00Z',
})
const ctx = { portalBaseUrl: 'https://app.test', workspaceName: 'WS', logoUrl: null } as never

const allPrefs = {
  emailMuted: false,
  emailTicketThreads: true,
  emailTicketProperties: true,
  emailTicketStatus: true,
  emailTicketAssignment: true,
  emailTicketParticipants: true,
  emailTicketShares: true,
  emailTicketSla: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  m.selectWhere.mockResolvedValue([]) // default: shares/loadActiveShares/principalRows/etc empty
  m.getSubscribers.mockResolvedValue(['p1'])
  m.resolvePortalLinked.mockResolvedValue({ principalIds: [], portalLinked: new Set() })
  m.resolvePrincipalsForContacts.mockResolvedValue([])
  m.canViewTicket.mockReturnValue(true)
  m.toResourceScope.mockReturnValue({})
  m.loadPermissionSet.mockResolvedValue({})
  m.batchGetPrefs.mockResolvedValue(new Map([['p1', allPrefs]]))
  m.batchGenTokens.mockResolvedValue(new Map())
  // principalRows + siblingRows + emails: sequence after loadActiveShares([])
  m.selectWhere
    .mockResolvedValueOnce([]) // loadActiveShares
    .mockResolvedValueOnce([{ id: 'p1', userId: 'u1' }]) // principalRows
    .mockResolvedValueOnce([{ id: 'p1', userId: 'u1' }]) // siblingRows
    .mockResolvedValueOnce([{ principalId: 'p1', email: 'a@x.test' }]) // emails
})

describe('early returns', () => {
  it('returns [] when there is no ticket', async () => {
    expect(
      await getTicketEmailTargets(
        { type: 'ticket.created', data: {}, actor: {}, timestamp: 't' } as never,
        ctx
      )
    ).toEqual([])
  })
  it('returns [] for an uncategorized event type', async () => {
    expect(await getTicketEmailTargets(ev('ticket.viewed') as never, ctx)).toEqual([])
  })
  it('returns [] when no candidate principals remain', async () => {
    m.getSubscribers.mockResolvedValueOnce([])
    expect(
      await getTicketEmailTargets(
        ev('ticket.status_changed', {
          previousStatusCategory: 'open',
          newStatusCategory: 'solved',
        }) as never,
        ctx
      )
    ).toEqual([])
  })
})

describe('per-category resolution', () => {
  it('status: builds targets via subscribers + ownership trust', async () => {
    const targets = await getTicketEmailTargets(
      ev('ticket.status_changed', {
        previousStatusCategory: 'open',
        newStatusCategory: 'solved',
      }) as never,
      ctx
    )
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ type: 'email', target: { email: 'a@x.test' } })
  })
  it('thread public: includes portal-linked recipients', async () => {
    m.resolvePortalLinked.mockResolvedValueOnce({
      principalIds: ['p1'],
      portalLinked: new Set(['p1']),
    })
    const targets = await getTicketEmailTargets(
      ev('ticket.thread_added', { audience: 'public', thread: { bodyText: 'hi' } }) as never,
      ctx
    )
    expect(targets).toHaveLength(1)
  })
  it('thread internal: drops requester + portal-linked', async () => {
    m.resolvePortalLinked.mockResolvedValueOnce({
      principalIds: ['p_portal'],
      portalLinked: new Set(['p_portal']),
    })
    m.getSubscribers.mockResolvedValueOnce(['p1', 'p_portal'])
    const targets = await getTicketEmailTargets(
      ev('ticket.thread_added', { audience: 'internal', thread: { bodyText: 'hi' } }) as never,
      ctx
    )
    expect(targets).toHaveLength(1) // p_portal filtered, p1 remains
  })
  it('assignment: gathers new + previous assignee', async () => {
    const e = ev('ticket.assigned', {
      previousAssigneePrincipalId: 'p_prev',
      newAssigneePrincipalId: 'p1',
    })
    ;(e.data.ticket as Record<string, unknown>).assigneePrincipalId = 'p1'
    expect(await getTicketEmailTargets(e as never, ctx)).toHaveLength(1)
  })
  it('participants: resolves a contactId to linked principals', async () => {
    m.resolvePrincipalsForContacts.mockResolvedValueOnce(['p1'])
    const targets = await getTicketEmailTargets(
      ev('ticket.participant_added', {
        addedPrincipalId: 'p1',
        addedContactId: 'contact_1',
        role: 'collaborator',
      }) as never,
      ctx
    )
    expect(targets).toHaveLength(1)
    expect(m.resolvePrincipalsForContacts).toHaveBeenCalled()
  })
  it('shares: loads team members', async () => {
    // teamMemberships select is the FIRST select for shares -> reset the queue
    m.selectWhere.mockReset()
    m.selectWhere
      .mockResolvedValueOnce([{ principalId: 'p1' }]) // team members
      .mockResolvedValueOnce([]) // loadActiveShares
      .mockResolvedValueOnce([{ id: 'p1', userId: 'u1' }]) // principalRows
      .mockResolvedValueOnce([{ id: 'p1', userId: 'u1' }]) // siblingRows
      .mockResolvedValueOnce([{ principalId: 'p1', email: 'a@x.test' }]) // emails
    const targets = await getTicketEmailTargets(
      ev('ticket.shared', { teamId: 'team_1', accessLevel: 'read' }) as never,
      ctx
    )
    expect(targets).toHaveLength(1)
  })
  it('sla: gathers assignee + subscribers', async () => {
    expect(
      await getTicketEmailTargets(
        ev('ticket.sla_warning', { ruleName: 'Rule', kind: 'first_response' }) as never,
        ctx
      )
    ).toHaveLength(1)
  })
  it('properties: includes portal-linked', async () => {
    expect(
      await getTicketEmailTargets(
        ev('ticket.updated', { changedFields: ['priority'] }) as never,
        ctx
      )
    ).toHaveLength(1)
  })
})

describe('actor suppression + permission gates', () => {
  it('suppresses the actor principal', async () => {
    m.getSubscribers.mockResolvedValueOnce(['p1', 'actor_p'])
    const targets = await getTicketEmailTargets(
      ev('ticket.status_changed', {}, 'actor_p') as never,
      ctx
    )
    expect(targets).toHaveLength(1) // actor_p removed, p1 remains
  })
  it('trusts an owning requester without a permission check', async () => {
    m.canViewTicket.mockReturnValue(false) // would deny via permission
    const e = ev('ticket.status_changed', {})
    ;(e.data.ticket as Record<string, unknown>).requesterPrincipalId = 'p1' // p1 is the requester -> trusted
    expect(await getTicketEmailTargets(e as never, ctx)).toHaveLength(1)
  })
  it('falls back to a sibling principal that can view', async () => {
    m.canViewTicket.mockReturnValueOnce(false).mockReturnValueOnce(true) // p1 denied, sibling allowed
    m.selectWhere.mockReset()
    m.selectWhere
      .mockResolvedValueOnce([]) // loadActiveShares
      .mockResolvedValueOnce([{ id: 'p1', userId: 'u1' }]) // principalRows
      .mockResolvedValueOnce([
        { id: 'p1', userId: 'u1' },
        { id: 'p_sibling', userId: 'u1' },
      ]) // siblings share user u1
      .mockResolvedValueOnce([{ principalId: 'p1', email: 'a@x.test' }]) // emails
    expect(await getTicketEmailTargets(ev('ticket.status_changed', {}) as never, ctx)).toHaveLength(
      1
    )
  })
  it('denies when permission check throws and no sibling helps', async () => {
    m.canViewTicket.mockReturnValue(false)
    m.loadPermissionSet.mockRejectedValue(new Error('authz down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await getTicketEmailTargets(ev('ticket.status_changed', {}) as never, ctx)).toEqual([])
  })
})

describe('preference + email filtering', () => {
  it('returns [] when preferences mute or disable the category', async () => {
    m.batchGetPrefs.mockResolvedValueOnce(
      new Map([['p1', { ...allPrefs, emailTicketStatus: false }]])
    )
    expect(await getTicketEmailTargets(ev('ticket.status_changed', {}) as never, ctx)).toEqual([])
  })
  it('returns [] when the principal has no preferences row', async () => {
    m.batchGetPrefs.mockResolvedValueOnce(new Map())
    expect(await getTicketEmailTargets(ev('ticket.status_changed', {}) as never, ctx)).toEqual([])
  })
  it('returns [] when no eligible subscriber has an email', async () => {
    m.selectWhere.mockReset()
    m.selectWhere
      .mockResolvedValueOnce([]) // loadActiveShares
      .mockResolvedValueOnce([{ id: 'p1', userId: 'u1' }]) // principalRows
      .mockResolvedValueOnce([{ id: 'p1', userId: 'u1' }]) // siblingRows
      .mockResolvedValueOnce([{ principalId: 'p1', email: null }]) // emails -> filtered out
    expect(await getTicketEmailTargets(ev('ticket.status_changed', {}) as never, ctx)).toEqual([])
  })
})
