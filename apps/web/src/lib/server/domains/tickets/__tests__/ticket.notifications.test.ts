/**
 * ticket.notifications — dispatcher policy: actor suppression, per-recipient
 * visibility filter, audience-aware thread filter, and team expansion for
 * `notifyTicketShared`.
 *
 * The DB chain + permission engine are mocked. The point is to lock the
 * recipient-resolution semantics so a future refactor can't silently leak
 * a notification to a principal who lost view permission or who triggered
 * the action themselves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSubscribersMock = vi.fn()
const loadPermissionSetMock = vi.fn()
const canViewTicketMock = vi.fn()
const createNotificationsBatchMock = vi.fn()

// Captured by db.select(...).from(...).where(...) for shares, and
// db.select(...).from(teamMemberships).where(...) for team expansion.
const sharesRows: Array<{ teamId: string; revokedAt: Date | null }> = []
const teamMembersRows: Array<{ principalId: string }> = []

vi.mock('@/lib/server/db', () => {
  const sharesChain = {
    from: vi.fn((tbl: { _name: string }) => {
      const isShares = tbl?._name === 'ticket_shares'
      return {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(isShares ? sharesRows : teamMembersRows),
      }
    }),
  }
  return {
    db: {
      select: vi.fn(() => sharesChain),
      selectDistinct: vi.fn(() => sharesChain),
    },
    eq: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
    isNull: vi.fn(),
    ticketShares: {
      _name: 'ticket_shares',
      teamId: 'team_id',
      revokedAt: 'revoked_at',
      ticketId: 'ticket_id',
    },
    teamMemberships: { _name: 'team_memberships', principalId: 'principal_id', teamId: 'team_id' },
    ticketSubscriptions: { _name: 'ticket_subscriptions' },
    ticketParticipants: {
      _name: 'ticket_participants',
      principalId: 'principal_id',
      contactId: 'contact_id',
      ticketId: 'ticket_id',
    },
    contactUserLinks: { _name: 'contact_user_links', contactId: 'contact_id', userId: 'user_id' },
    principal: { _name: 'principal', id: 'id', userId: 'user_id' },
  }
})

vi.mock('../ticket.subscriptions', () => ({
  getSubscribers: (...args: unknown[]) => getSubscribersMock(...args),
}))

vi.mock('../../authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => loadPermissionSetMock(...args),
}))

vi.mock('../ticket.permissions', () => ({
  canViewTicket: (...args: unknown[]) => canViewTicketMock(...args),
  toResourceScope: (input: unknown) => ({ _scope: input }),
}))

vi.mock('../../notifications/notification.service', () => ({
  createNotificationsBatch: (...args: unknown[]) => createNotificationsBatchMock(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  getSubscribersMock.mockReset()
  loadPermissionSetMock.mockReset().mockResolvedValue({ permissions: new Set() })
  canViewTicketMock.mockReset().mockReturnValue(true)
  createNotificationsBatchMock.mockReset().mockResolvedValue(undefined)
  sharesRows.length = 0
  teamMembersRows.length = 0
})

const baseTicket = {
  id: 'ticket_1',
  subject: 'Hello',
  primaryTeamId: 'team_a',
  assigneePrincipalId: null,
  assigneeTeamId: null,
  requesterPrincipalId: null,
} as Record<string, unknown>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T = (extra: Record<string, unknown> = {}): any => ({ ...baseTicket, ...extra })

describe('notifyTicketAssigned', () => {
  it('does not notify when there is no new assignee or previous assignee', async () => {
    getSubscribersMock.mockResolvedValue(['principal_sub'])
    const { notifyTicketAssigned } = await import('../ticket.notifications')

    await notifyTicketAssigned(T({ assigneePrincipalId: null }), null, {
      actorPrincipalId: 'principal_actor' as never,
    })

    expect(createNotificationsBatchMock).not.toHaveBeenCalled()
  })

  it('suppresses actor and notifies new + previous assignee separately', async () => {
    getSubscribersMock.mockResolvedValue([])
    const { notifyTicketAssigned } = await import('../ticket.notifications')
    await notifyTicketAssigned(
      T({ assigneePrincipalId: 'principal_new' }),
      'principal_prev' as never,
      { actorPrincipalId: 'principal_actor' as never }
    )
    expect(createNotificationsBatchMock).toHaveBeenCalledTimes(2)
    const allRecipients = createNotificationsBatchMock.mock.calls
      .flatMap((c) => c[0])
      .map((row) => row.principalId)
    expect(allRecipients).toContain('principal_new')
    expect(allRecipients).toContain('principal_prev')
    expect(allRecipients).not.toContain('principal_actor')
  })

  it('drops the actor even if they are the new assignee', async () => {
    getSubscribersMock.mockResolvedValue([])
    const { notifyTicketAssigned } = await import('../ticket.notifications')
    await notifyTicketAssigned(T({ assigneePrincipalId: 'principal_self' }), null, {
      actorPrincipalId: 'principal_self' as never,
    })
    // Only the new-assignee dispatch attempt fires; recipient set after
    // suppression is empty so no batch insert happens.
    expect(createNotificationsBatchMock).not.toHaveBeenCalled()
  })
})

describe('notifyTicketCreated and status changes', () => {
  it('notifies requester and assignee when a ticket is opened', async () => {
    getSubscribersMock.mockResolvedValue(['principal_sub'])
    const { notifyTicketCreated } = await import('../ticket.notifications')

    await notifyTicketCreated(
      T({ requesterPrincipalId: 'principal_req', assigneePrincipalId: 'principal_agent' }),
      { actorPrincipalId: 'principal_actor' as never }
    )

    const recipients = createNotificationsBatchMock.mock.calls
      .flatMap((c) => c[0])
      .map((row) => row.principalId)
    expect(recipients).toEqual(['principal_sub', 'principal_req', 'principal_agent'])
    expect(createNotificationsBatchMock.mock.calls[0][0][0]).toMatchObject({
      type: 'ticket_thread_added',
      title: 'Ticket opened: Hello',
    })
  })

  it('uses fallback subject and previous-category text for status changes', async () => {
    getSubscribersMock.mockResolvedValue(['principal_sub'])
    const { notifyTicketStatusChanged } = await import('../ticket.notifications')

    await notifyTicketStatusChanged(T({ subject: null }), null, 'closed', {
      actorPrincipalId: null,
    })

    expect(createNotificationsBatchMock.mock.calls[0][0][0]).toMatchObject({
      title: 'Status: ticket',
      body: '— → closed',
      metadata: { ticketId: 'ticket_1', from: null, to: 'closed' },
    })
  })
})

describe('notifyThreadAdded', () => {
  it('public audience keeps the requester in the recipient set', async () => {
    getSubscribersMock.mockResolvedValue([])
    const { notifyThreadAdded } = await import('../ticket.notifications')
    await notifyThreadAdded(
      T({ requesterPrincipalId: 'principal_req' }),
      'thread_1',
      'public',
      null,
      { actorPrincipalId: 'principal_agent' as never }
    )
    const recipients = createNotificationsBatchMock.mock.calls
      .flatMap((c) => c[0])
      .map((row) => row.principalId)
    expect(recipients).toContain('principal_req')
  })

  it('internal audience drops the requester', async () => {
    getSubscribersMock.mockResolvedValue([])
    const { notifyThreadAdded } = await import('../ticket.notifications')
    await notifyThreadAdded(
      T({
        requesterPrincipalId: 'principal_req',
        assigneePrincipalId: 'principal_agent',
      }),
      'thread_1',
      'internal',
      null,
      { actorPrincipalId: 'principal_someone_else' as never }
    )
    const recipients = createNotificationsBatchMock.mock.calls
      .flatMap((c) => c[0])
      .map((row) => row.principalId)
    expect(recipients).not.toContain('principal_req')
    expect(recipients).toContain('principal_agent')
  })
})

describe('dispatch visibility filter', () => {
  it('drops principals whose canViewTicket returns false', async () => {
    getSubscribersMock.mockResolvedValue(['principal_a', 'principal_b', 'principal_c'])
    canViewTicketMock.mockImplementation(() => true)
    // The 2nd permission load will yield a "denied" set.
    let call = 0
    canViewTicketMock.mockImplementation(() => {
      call += 1
      return call !== 2 // deny the 2nd recipient
    })
    const { notifyTicketStatusChanged } = await import('../ticket.notifications')
    await notifyTicketStatusChanged(T(), 'open', 'pending', { actorPrincipalId: null })
    const rows = createNotificationsBatchMock.mock.calls.flatMap((c) => c[0])
    expect(rows).toHaveLength(2) // 3 candidates − 1 denied
  })

  it('skips a recipient when permission loading fails', async () => {
    getSubscribersMock.mockResolvedValue(['principal_bad'])
    loadPermissionSetMock.mockRejectedValueOnce(new Error('permission db unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const { notifyTicketStatusChanged } = await import('../ticket.notifications')
      await notifyTicketStatusChanged(T(), 'open', 'pending', { actorPrincipalId: null })

      expect(createNotificationsBatchMock).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        '[tickets.notifications] permission check failed for',
        'principal_bad',
        expect.any(Error)
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe('notifyTicketShared', () => {
  it('expands team members + adds them to the recipient set', async () => {
    getSubscribersMock.mockResolvedValue([])
    teamMembersRows.push({ principalId: 'principal_x' }, { principalId: 'principal_y' })
    const { notifyTicketShared } = await import('../ticket.notifications')
    await notifyTicketShared(T(), 'team_b' as never, {
      actorPrincipalId: 'principal_x' as never,
    })
    const recipients = createNotificationsBatchMock.mock.calls
      .flatMap((c) => c[0])
      .map((row) => row.principalId)
    // principal_x is the actor → suppressed; principal_y survives.
    expect(recipients).toEqual(['principal_y'])
  })

  it('expands team members for unshare notifications', async () => {
    getSubscribersMock.mockResolvedValue(['principal_sub'])
    teamMembersRows.push({ principalId: 'principal_x' })
    const { notifyTicketUnshared } = await import('../ticket.notifications')

    await notifyTicketUnshared(T(), 'team_b' as never, {
      actorPrincipalId: 'principal_actor' as never,
    })

    const rows = createNotificationsBatchMock.mock.calls.flatMap((c) => c[0])
    expect(rows.map((row) => row.principalId)).toEqual(['principal_x', 'principal_sub'])
    expect(rows[0]).toMatchObject({
      type: 'ticket_unshared',
      title: 'Ticket access revoked: Hello',
      metadata: { ticketId: 'ticket_1', teamId: 'team_b' },
    })
  })
})

describe('SLA notifications', () => {
  it('does not dispatch SLA warnings when there are no explicit recipients', async () => {
    const { notifyTicketSlaWarning } = await import('../ticket.notifications')

    await notifyTicketSlaWarning(T(), 'first_response', 'First response', [])

    expect(getSubscribersMock).not.toHaveBeenCalled()
    expect(createNotificationsBatchMock).not.toHaveBeenCalled()
  })

  it('notifies explicit and subscribed recipients for SLA warnings', async () => {
    getSubscribersMock.mockResolvedValue(['principal_sub'])
    const { notifyTicketSlaWarning } = await import('../ticket.notifications')

    await notifyTicketSlaWarning(T(), 'first_response', 'First response', [
      'principal_agent' as never,
    ])

    const rows = createNotificationsBatchMock.mock.calls.flatMap((c) => c[0])
    expect(rows.map((row) => row.principalId)).toEqual(['principal_agent', 'principal_sub'])
    expect(rows[0]).toMatchObject({
      type: 'ticket_sla_warning',
      body: 'First response (first response) escalation triggered.',
    })
  })

  it('notifies assignee and subscribers for SLA breaches', async () => {
    getSubscribersMock.mockResolvedValue(['principal_sub'])
    const { notifyTicketSlaBreach } = await import('../ticket.notifications')

    await notifyTicketSlaBreach(T({ assigneePrincipalId: 'principal_agent' }), 'next_response')

    const rows = createNotificationsBatchMock.mock.calls.flatMap((c) => c[0])
    expect(rows.map((row) => row.principalId)).toEqual(['principal_agent', 'principal_sub'])
    expect(rows[0]).toMatchObject({
      type: 'ticket_sla_breach',
      body: 'next response target was missed.',
    })
  })
})
