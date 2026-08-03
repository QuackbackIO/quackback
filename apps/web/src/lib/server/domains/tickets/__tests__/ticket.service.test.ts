/**
 * ticket.service — focused unit tests for status-transition timestamp logic
 * and optimistic-concurrency rejection. Pure DB chains are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- shared mocks ----
const ticketFindFirstMock = vi.fn()
const statusFindFirstMock = vi.fn()
const principalFindFirstMock = vi.fn()
const userFindFirstMock = vi.fn()
const insertTicketsReturningMock = vi.fn()
const insertActivityReturningMock = vi.fn()
const updateTicketsReturningMock = vi.fn()
const selectTicketsWhereMock = vi.fn()
const recordEventMock = vi.fn()
const findOrCreateByEmailMock = vi.fn()
const linkContactToUserMock = vi.fn()
const listLinksForUserMock = vi.fn()
const getContactMock = vi.fn()
const routeMock = vi.fn()
const bumpMatchStatsMock = vi.fn()
const attachClocksOnCreateMock = vi.fn()
const onStatusTransitionMock = vi.fn()
const safeSubscribeMock = vi.fn()
const notifyTicketCreatedMock = vi.fn()
const notifyTicketAssignedMock = vi.fn()
const notifyTicketStatusChangedMock = vi.fn()
/** Captures the .values(...) payload for every tickets insert. */
const ticketInsertValuesCalls: Array<Record<string, unknown>> = []

vi.mock('../../organizations/contact.service', () => ({
  findOrCreateByEmail: (...args: unknown[]) => findOrCreateByEmailMock(...args),
  linkContactToUser: (...args: unknown[]) => linkContactToUserMock(...args),
  listLinksForUser: (...args: unknown[]) => listLinksForUserMock(...args),
  getContact: (...args: unknown[]) => getContactMock(...args),
}))

const dispatchTicketUpdatedMock = vi.fn()
const dispatchTicketDeletedMock = vi.fn()
const dispatchTicketRestoredMock = vi.fn()
const dispatchTicketCreatedMock = vi.fn()
const dispatchTicketAssignedMock = vi.fn()
const dispatchTicketUnassignedMock = vi.fn()
const dispatchTicketStatusChangedMock = vi.fn()
vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (a: { principalId?: string }) => ({
    type: 'user',
    principalId: a.principalId,
  }),
  dispatchTicketCreated: (...a: unknown[]) => dispatchTicketCreatedMock(...a),
  dispatchTicketUpdated: (...a: unknown[]) => dispatchTicketUpdatedMock(...a),
  dispatchTicketDeleted: (...a: unknown[]) => dispatchTicketDeletedMock(...a),
  dispatchTicketRestored: (...a: unknown[]) => dispatchTicketRestoredMock(...a),
  dispatchTicketAssigned: (...a: unknown[]) => dispatchTicketAssignedMock(...a),
  dispatchTicketUnassigned: (...a: unknown[]) => dispatchTicketUnassignedMock(...a),
  dispatchTicketStatusChanged: (...a: unknown[]) => dispatchTicketStatusChangedMock(...a),
}))

vi.mock('../../inboxes/routing.engine', () => ({
  route: (...args: unknown[]) => routeMock(...args),
}))

vi.mock('../../inboxes/routing.service', () => ({
  bumpMatchStats: (...args: unknown[]) => bumpMatchStatsMock(...args),
}))

vi.mock('../../sla/sla.engine', () => ({
  attachClocksOnCreate: (...args: unknown[]) => attachClocksOnCreateMock(...args),
  onStatusTransition: (...args: unknown[]) => onStatusTransitionMock(...args),
}))

vi.mock('../ticket.subscriptions', () => ({
  safeSubscribe: (...args: unknown[]) => safeSubscribeMock(...args),
}))

vi.mock('../ticket.notifications', () => ({
  notifyTicketCreated: (...args: unknown[]) => notifyTicketCreatedMock(...args),
  notifyTicketAssigned: (...args: unknown[]) => notifyTicketAssignedMock(...args),
  notifyTicketStatusChanged: (...args: unknown[]) => notifyTicketStatusChangedMock(...args),
}))

vi.mock('@/lib/server/db', () => {
  function makeInsertChain(target: 'tickets' | 'activity') {
    return {
      values: vi.fn((payload: Record<string, unknown>) => {
        if (target === 'tickets') ticketInsertValuesCalls.push(payload)
        return {
          values: vi.fn().mockReturnThis(),
          returning:
            target === 'tickets' ? insertTicketsReturningMock : insertActivityReturningMock,
        }
      }),
      returning: target === 'tickets' ? insertTicketsReturningMock : insertActivityReturningMock,
    }
  }
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: updateTicketsReturningMock,
  }
  return {
    db: {
      query: {
        tickets: { findFirst: ticketFindFirstMock },
        ticketStatuses: { findFirst: statusFindFirstMock },
        principal: { findFirst: principalFindFirstMock },
        user: { findFirst: userFindFirstMock },
      },
      insert: vi.fn((tbl: { _name: string }) => {
        if (tbl?._name === 'ticket_activity') return makeInsertChain('activity')
        return makeInsertChain('tickets')
      }),
      update: vi.fn(() => updateChain),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: (...args: unknown[]) => selectTicketsWhereMock(...args),
        })),
      })),
      delete: vi.fn(),
    },
    eq: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
    inArray: vi.fn((left: unknown, right: unknown) => ['inArray', left, right]),
    asc: vi.fn(),
    desc: vi.fn(),
    ilike: vi.fn(),
    sql: vi.fn(),
    tickets: { _name: 'tickets', id: 'tickets.id', updatedAt: 'tickets.updated_at' },
    ticketStatuses: { _name: 'ticket_statuses', id: 'ticket_statuses.id' },
    ticketActivity: { _name: 'ticket_activity' },
    ticketShares: { _name: 'ticket_shares' },
    principal: { _name: 'principal', id: 'principal.id' },
    user: { _name: 'user', id: 'user.id' },
    TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'] as const,
    TICKET_CHANNELS: ['api', 'email', 'web', 'chat'] as const,
    TICKET_VISIBILITY_SCOPES: ['team', 'org', 'shared', 'private'] as const,
  }
})

vi.mock('@/lib/server/sanitize-tiptap', () => ({
  sanitizeTiptapContent: (c: unknown) => c,
}))

vi.mock('../../audit', () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}))

vi.mock('@/lib/shared/errors', () => {
  class DomainErr extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  }
  return {
    ConflictError: DomainErr,
    NotFoundError: DomainErr,
    ValidationError: DomainErr,
    ForbiddenError: DomainErr,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  ticketFindFirstMock.mockReset()
  statusFindFirstMock.mockReset()
  principalFindFirstMock.mockReset()
  userFindFirstMock.mockReset()
  insertTicketsReturningMock.mockReset()
  insertActivityReturningMock.mockReset()
  updateTicketsReturningMock.mockReset()
  selectTicketsWhereMock.mockReset()
  selectTicketsWhereMock.mockResolvedValue([])
  findOrCreateByEmailMock.mockReset()
  linkContactToUserMock.mockReset()
  listLinksForUserMock.mockReset().mockResolvedValue([])
  getContactMock.mockReset().mockResolvedValue(null)
  ticketInsertValuesCalls.length = 0
  insertActivityReturningMock.mockResolvedValue([{ id: 'ticket_act_x' }])
  recordEventMock.mockReset()
  routeMock.mockReset()
  routeMock.mockResolvedValue(null)
  bumpMatchStatsMock.mockReset()
  bumpMatchStatsMock.mockResolvedValue(undefined)
  attachClocksOnCreateMock.mockReset()
  attachClocksOnCreateMock.mockResolvedValue(undefined)
  onStatusTransitionMock.mockReset()
  onStatusTransitionMock.mockResolvedValue(undefined)
  safeSubscribeMock.mockReset()
  safeSubscribeMock.mockResolvedValue(undefined)
  notifyTicketCreatedMock.mockReset()
  notifyTicketCreatedMock.mockResolvedValue(undefined)
  notifyTicketAssignedMock.mockReset()
  notifyTicketAssignedMock.mockResolvedValue(undefined)
  notifyTicketStatusChangedMock.mockReset()
  notifyTicketStatusChangedMock.mockResolvedValue(undefined)
  dispatchTicketUpdatedMock.mockReset()
  dispatchTicketUpdatedMock.mockResolvedValue(undefined)
  dispatchTicketDeletedMock.mockReset()
  dispatchTicketDeletedMock.mockResolvedValue(undefined)
  dispatchTicketRestoredMock.mockReset()
  dispatchTicketRestoredMock.mockResolvedValue(undefined)
  dispatchTicketCreatedMock.mockReset()
  dispatchTicketCreatedMock.mockResolvedValue(undefined)
  dispatchTicketAssignedMock.mockReset()
  dispatchTicketAssignedMock.mockResolvedValue(undefined)
  dispatchTicketUnassignedMock.mockReset()
  dispatchTicketUnassignedMock.mockResolvedValue(undefined)
  dispatchTicketStatusChangedMock.mockReset()
  dispatchTicketStatusChangedMock.mockResolvedValue(undefined)
})

const FIXED_NOW = new Date('2026-05-01T10:00:00.000Z')

function baseTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket_1',
    statusId: 'ticket_status_open',
    updatedAt: new Date('2026-04-30T09:00:00.000Z'),
    assigneePrincipalId: null,
    assigneeTeamId: null,
    primaryTeamId: null,
    requesterPrincipalId: null,
    firstResponseAt: null,
    resolvedAt: null,
    reopenedAt: null,
    closedAt: null,
    deletedAt: null,
    subject: 'Help',
    priority: 'normal',
    visibilityScope: 'team',
    organizationId: null,
    requesterContactId: null,
    descriptionJson: null,
    descriptionText: null,
    ...overrides,
  }
}

describe('transitionStatus', () => {
  it('rejects with TICKET_STALE when expectedUpdatedAt does not match', async () => {
    ticketFindFirstMock.mockResolvedValueOnce(baseTicket())
    const { transitionStatus } = await import('../ticket.service')
    await expect(
      transitionStatus('ticket_1' as never, {
        expectedUpdatedAt: new Date('2025-01-01T00:00:00.000Z'),
        actorPrincipalId: null,
        statusId: 'ticket_status_solved' as never,
      })
    ).rejects.toThrow(/modified concurrently/i)
  })

  it('sets resolvedAt when moving to a solved-category status', async () => {
    const ticket = baseTicket()
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    statusFindFirstMock
      .mockResolvedValueOnce({ id: 'ticket_status_solved', category: 'solved' })
      .mockResolvedValueOnce({ id: 'ticket_status_open', category: 'open' })
    updateTicketsReturningMock.mockResolvedValueOnce([
      { ...ticket, statusId: 'ticket_status_solved', resolvedAt: FIXED_NOW },
    ])
    const { transitionStatus } = await import('../ticket.service')
    const result = await transitionStatus('ticket_1' as never, {
      expectedUpdatedAt: ticket.updatedAt,
      actorPrincipalId: null,
      statusId: 'ticket_status_solved' as never,
    })
    expect(result.statusId).toBe('ticket_status_solved')
    expect(result.resolvedAt).not.toBeNull()
  })

  it('sets reopenedAt and clears resolvedAt when moving from solved to open', async () => {
    const ticket = baseTicket({
      statusId: 'ticket_status_solved',
      resolvedAt: new Date('2026-04-29T12:00:00.000Z'),
    })
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    statusFindFirstMock
      .mockResolvedValueOnce({ id: 'ticket_status_open', category: 'open' })
      .mockResolvedValueOnce({ id: 'ticket_status_solved', category: 'solved' })
    updateTicketsReturningMock.mockResolvedValueOnce([
      { ...ticket, statusId: 'ticket_status_open', resolvedAt: null, reopenedAt: FIXED_NOW },
    ])
    const { transitionStatus } = await import('../ticket.service')
    const result = await transitionStatus('ticket_1' as never, {
      expectedUpdatedAt: ticket.updatedAt,
      actorPrincipalId: null,
      statusId: 'ticket_status_open' as never,
    })
    expect(result.resolvedAt).toBeNull()
    expect(result.reopenedAt).not.toBeNull()
  })

  it('returns the existing row unchanged when target status equals current', async () => {
    const ticket = baseTicket({ statusId: 'ticket_status_open' })
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    const { transitionStatus } = await import('../ticket.service')
    const result = await transitionStatus('ticket_1' as never, {
      expectedUpdatedAt: ticket.updatedAt,
      actorPrincipalId: null,
      statusId: 'ticket_status_open' as never,
    })
    expect(result).toEqual(ticket)
    expect(updateTicketsReturningMock).not.toHaveBeenCalled()
  })

  it('throws TICKET_STALE when underlying UPDATE returns 0 rows', async () => {
    const ticket = baseTicket()
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    statusFindFirstMock
      .mockResolvedValueOnce({ id: 'ticket_status_solved', category: 'solved' })
      .mockResolvedValueOnce({ id: 'ticket_status_open', category: 'open' })
    updateTicketsReturningMock.mockResolvedValueOnce([])
    const { transitionStatus } = await import('../ticket.service')
    await expect(
      transitionStatus('ticket_1' as never, {
        expectedUpdatedAt: ticket.updatedAt,
        actorPrincipalId: null,
        statusId: 'ticket_status_solved' as never,
      })
    ).rejects.toThrow(/modified concurrently/i)
  })
})

describe('createTicket', () => {
  it('rejects empty subject', async () => {
    const { createTicket } = await import('../ticket.service')
    await expect(createTicket({ subject: '   ' })).rejects.toThrow(/subject is required/i)
  })

  it('rejects invalid priority, channel, and visibility values', async () => {
    const { createTicket } = await import('../ticket.service')
    await expect(createTicket({ subject: 'Hi', priority: 'bad' as never })).rejects.toMatchObject({
      code: 'TICKET_PRIORITY_INVALID',
    })
    await expect(createTicket({ subject: 'Hi', channel: 'bad' as never })).rejects.toMatchObject({
      code: 'TICKET_CHANNEL_INVALID',
    })
    await expect(
      createTicket({ subject: 'Hi', visibilityScope: 'bad' as never })
    ).rejects.toMatchObject({
      code: 'TICKET_VISIBILITY_INVALID',
    })
  })

  it('uses the workspace default status when statusId omitted', async () => {
    statusFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_status_open',
      category: 'open',
    })
    insertTicketsReturningMock.mockResolvedValueOnce([
      { id: 'ticket_1', statusId: 'ticket_status_open', subject: 'Hi' },
    ])
    const { createTicket } = await import('../ticket.service')
    const result = await createTicket({ subject: 'Hi' })
    expect(result.id).toBe('ticket_1')
    expect(statusFindFirstMock).toHaveBeenCalled()
  })

  it('rejects when no default status is configured and none provided', async () => {
    statusFindFirstMock.mockResolvedValueOnce(undefined)
    const { createTicket } = await import('../ticket.service')
    await expect(createTicket({ subject: 'Hi' })).rejects.toThrow(/default ticket status/i)
  })

  it('applies routing decisions, bumps match stats, subscribes principals, and dispatches creation side effects', async () => {
    statusFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_status_open',
      category: 'open',
    })
    routeMock.mockResolvedValueOnce({
      matchedRuleId: 'routing_rule_1',
      inboxId: 'inbox_routed',
      primaryTeamId: 'team_primary',
      assigneePrincipalId: 'principal_assignee',
      assigneeTeamId: 'team_assignee',
      priority: 'high',
      visibilityScope: 'shared',
    })
    const created = baseTicket({
      id: 'ticket_created',
      subject: 'Routed ticket',
      inboxId: 'inbox_routed',
      assigneePrincipalId: 'principal_assignee',
    })
    insertTicketsReturningMock.mockResolvedValueOnce([created])

    const { createTicket } = await import('../ticket.service')
    await expect(
      createTicket({
        subject: '  Routed ticket  ',
        descriptionText: '  body  ',
        requesterPrincipalId: 'principal_requester' as never,
        createdByPrincipalId: 'principal_actor' as never,
        channel: 'email',
        syncSourceIntegrationId: 'github_1',
      })
    ).resolves.toBe(created)

    expect(routeMock).toHaveBeenCalledWith({
      subject: 'Routed ticket',
      descriptionText: 'body',
      channel: 'email',
      priority: undefined,
      candidateInboxId: null,
    })
    expect(ticketInsertValuesCalls[0]).toMatchObject({
      subject: 'Routed ticket',
      descriptionText: 'body',
      priority: 'high',
      channel: 'email',
      visibilityScope: 'shared',
      statusId: 'ticket_status_open',
      primaryTeamId: 'team_primary',
      assigneePrincipalId: 'principal_assignee',
      assigneeTeamId: 'team_assignee',
      requesterPrincipalId: 'principal_requester',
      inboxId: 'inbox_routed',
    })
    expect(bumpMatchStatsMock).toHaveBeenCalledWith('routing_rule_1')
    expect(attachClocksOnCreateMock).toHaveBeenCalledWith(created, 'principal_actor')
    expect(safeSubscribeMock).toHaveBeenCalledWith({
      ticketId: 'ticket_created',
      principalId: 'principal_requester',
      source: 'manual',
    })
    expect(safeSubscribeMock).toHaveBeenCalledWith({
      ticketId: 'ticket_created',
      principalId: 'principal_assignee',
      source: 'auto_assigned',
    })
    expect(notifyTicketCreatedMock).toHaveBeenCalledWith(created, {
      actorPrincipalId: 'principal_actor',
    })
    expect(dispatchTicketCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'principal_actor' }),
      created,
      { syncSourceIntegrationId: 'github_1' }
    )
  })

  it('does not route when caller supplies an inbox explicitly', async () => {
    statusFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_status_open',
      category: 'open',
    })
    insertTicketsReturningMock.mockResolvedValueOnce([
      baseTicket({ id: 'ticket_explicit', inboxId: 'inbox_explicit' }),
    ])

    const { createTicket } = await import('../ticket.service')
    await createTicket({ subject: 'Explicit', inboxId: 'inbox_explicit' as never })

    expect(routeMock).not.toHaveBeenCalled()
    expect(ticketInsertValuesCalls[0]?.inboxId).toBe('inbox_explicit')
  })

  describe('requesterContactId resolution', () => {
    function stubDefaultStatus() {
      statusFindFirstMock.mockResolvedValue({ id: 'ticket_status_open', category: 'open' })
      insertTicketsReturningMock.mockResolvedValue([
        { id: 'ticket_1', statusId: 'ticket_status_open', subject: 'Hi' },
      ])
    }

    it('derives a contact from the portal user email when only principal is supplied', async () => {
      stubDefaultStatus()
      principalFindFirstMock.mockResolvedValueOnce({ userId: 'user_1', type: 'user' })
      userFindFirstMock.mockResolvedValueOnce({ email: '[email protected]', emailVerified: true })
      findOrCreateByEmailMock.mockResolvedValueOnce({ id: 'contact_x' })
      linkContactToUserMock.mockResolvedValueOnce({ id: 'cu_link_x' })
      const { createTicket } = await import('../ticket.service')
      await createTicket({
        subject: 'Hi',
        requesterPrincipalId: 'principal_1' as never,
      })
      expect(findOrCreateByEmailMock).toHaveBeenCalledWith({ email: '[email protected]' })
      expect(linkContactToUserMock).toHaveBeenCalledWith({
        contactId: 'contact_x',
        userId: 'user_1',
        linkedByPrincipalId: null,
      })
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe('contact_x')
      expect(ticketInsertValuesCalls[0]?.requesterPrincipalId).toBe('principal_1')
    })

    it('uses an existing contact link before deriving by email', async () => {
      stubDefaultStatus()
      principalFindFirstMock.mockResolvedValueOnce({ userId: 'user_1', type: 'user' })
      listLinksForUserMock.mockResolvedValueOnce([{ contactId: 'contact_linked' }])
      const { createTicket } = await import('../ticket.service')
      await createTicket({
        subject: 'Hi',
        requesterPrincipalId: 'principal_1' as never,
      })
      expect(userFindFirstMock).not.toHaveBeenCalled()
      expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe('contact_linked')
    })

    it('derives organizationId from the resolved contact when caller omits it', async () => {
      stubDefaultStatus()
      principalFindFirstMock.mockResolvedValueOnce({ userId: 'user_1', type: 'user' })
      listLinksForUserMock.mockResolvedValueOnce([{ contactId: 'contact_linked' }])
      getContactMock.mockResolvedValueOnce({ id: 'contact_linked', organizationId: 'org_1' })
      const { createTicket } = await import('../ticket.service')
      await createTicket({
        subject: 'Hi',
        requesterPrincipalId: 'principal_1' as never,
      })
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe('contact_linked')
      expect(ticketInsertValuesCalls[0]?.organizationId).toBe('org_1')
    })

    it('preserves caller-provided organizationId over contact enrichment', async () => {
      stubDefaultStatus()
      getContactMock.mockResolvedValueOnce({
        id: 'contact_explicit',
        organizationId: 'org_contact',
      })
      const { createTicket } = await import('../ticket.service')
      await createTicket({
        subject: 'Hi',
        requesterContactId: 'contact_explicit' as never,
        organizationId: 'org_explicit' as never,
      })
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe('contact_explicit')
      expect(ticketInsertValuesCalls[0]?.organizationId).toBe('org_explicit')
    })

    it('keeps caller-provided requesterContactId and skips derivation', async () => {
      stubDefaultStatus()
      const { createTicket } = await import('../ticket.service')
      await createTicket({
        subject: 'Hi',
        requesterPrincipalId: 'principal_1' as never,
        requesterContactId: 'contact_explicit' as never,
      })
      expect(principalFindFirstMock).not.toHaveBeenCalled()
      expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe('contact_explicit')
    })

    it('skips derivation for anonymous principals', async () => {
      stubDefaultStatus()
      principalFindFirstMock.mockResolvedValueOnce({ userId: 'user_anon', type: 'anonymous' })
      const { createTicket } = await import('../ticket.service')
      await createTicket({
        subject: 'Hi',
        requesterPrincipalId: 'principal_anon' as never,
      })
      expect(userFindFirstMock).not.toHaveBeenCalled()
      expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe(null)
    })

    it('skips derivation when the user has no email', async () => {
      stubDefaultStatus()
      principalFindFirstMock.mockResolvedValueOnce({ userId: 'user_2', type: 'user' })
      userFindFirstMock.mockResolvedValueOnce({ email: null })
      const { createTicket } = await import('../ticket.service')
      await createTicket({
        subject: 'Hi',
        requesterPrincipalId: 'principal_2' as never,
      })
      expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe(null)
    })

    it('skips derivation when the user email is unverified', async () => {
      stubDefaultStatus()
      principalFindFirstMock.mockResolvedValueOnce({ userId: 'user_2', type: 'user' })
      userFindFirstMock.mockResolvedValueOnce({
        email: '[email protected]',
        emailVerified: false,
      })
      const { createTicket } = await import('../ticket.service')
      await createTicket({
        subject: 'Hi',
        requesterPrincipalId: 'principal_2' as never,
      })
      expect(findOrCreateByEmailMock).not.toHaveBeenCalled()
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe(null)
    })

    it('swallows resolver errors and still creates the ticket', async () => {
      stubDefaultStatus()
      principalFindFirstMock.mockRejectedValueOnce(new Error('db down'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { createTicket } = await import('../ticket.service')
      const result = await createTicket({
        subject: 'Hi',
        requesterPrincipalId: 'principal_3' as never,
      })
      expect(result.id).toBe('ticket_1')
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe(null)
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('does not touch principal/user when only contact is supplied (inbound-email path)', async () => {
      stubDefaultStatus()
      const { createTicket } = await import('../ticket.service')
      await createTicket({
        subject: 'Hi',
        requesterContactId: 'contact_inbound' as never,
      })
      expect(principalFindFirstMock).not.toHaveBeenCalled()
      expect(userFindFirstMock).not.toHaveBeenCalled()
      expect(ticketInsertValuesCalls[0]?.requesterContactId).toBe('contact_inbound')
      expect(ticketInsertValuesCalls[0]?.requesterPrincipalId).toBe(null)
    })
  })
})

describe('updateTicket — webhook dispatch', () => {
  it('dispatches ticket.updated with changedFields when fields actually change', async () => {
    const ticket = baseTicket({ priority: 'normal' })
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    updateTicketsReturningMock.mockResolvedValueOnce([{ ...ticket, priority: 'high' }])
    const { updateTicket } = await import('../ticket.service')
    await updateTicket('ticket_1' as never, {
      expectedUpdatedAt: ticket.updatedAt,
      actorPrincipalId: 'principal_actor' as never,
      priority: 'high',
    })
    expect(dispatchTicketUpdatedMock).toHaveBeenCalledTimes(1)
    const [, , changedFields, diff] = dispatchTicketUpdatedMock.mock.calls[0]
    expect(changedFields).toEqual(['priority'])
    expect((diff as Record<string, { from: unknown; to: unknown }>).priority).toEqual({
      from: 'normal',
      to: 'high',
    })
  })

  it('does NOT dispatch ticket.updated when no fields change', async () => {
    const ticket = baseTicket({ priority: 'normal' })
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    const { updateTicket } = await import('../ticket.service')
    await updateTicket('ticket_1' as never, {
      expectedUpdatedAt: ticket.updatedAt,
      actorPrincipalId: 'principal_actor' as never,
      priority: 'normal',
    })
    expect(dispatchTicketUpdatedMock).not.toHaveBeenCalled()
  })

  it('merges stale field-only updates when explicitly allowed', async () => {
    const staleTicket = baseTicket({
      subject: 'Old subject',
      updatedAt: new Date('2026-04-30T09:00:00.000Z'),
    })
    const latestTicket = baseTicket({
      subject: 'Latest subject',
      updatedAt: new Date('2026-05-01T09:00:00.000Z'),
    })
    const updated = { ...latestTicket, subject: 'Merged subject' }
    ticketFindFirstMock.mockResolvedValueOnce(staleTicket).mockResolvedValueOnce(latestTicket)
    updateTicketsReturningMock.mockResolvedValueOnce([updated])

    const { updateTicket } = await import('../ticket.service')
    await expect(
      updateTicket('ticket_1' as never, {
        expectedUpdatedAt: new Date('2026-04-29T09:00:00.000Z'),
        actorPrincipalId: 'principal_actor' as never,
        subject: 'Merged subject',
        allowStaleFieldUpdate: true,
      })
    ).resolves.toEqual(updated)
  })
})

describe('assignTicket', () => {
  it('returns unchanged when assignment is identical', async () => {
    const ticket = baseTicket({ assigneePrincipalId: 'principal_a', assigneeTeamId: 'team_a' })
    ticketFindFirstMock.mockResolvedValueOnce(ticket)

    const { assignTicket } = await import('../ticket.service')
    await expect(
      assignTicket('ticket_1' as never, {
        expectedUpdatedAt: ticket.updatedAt,
        actorPrincipalId: 'principal_actor' as never,
        assigneePrincipalId: 'principal_a' as never,
        assigneeTeamId: 'team_a' as never,
      })
    ).resolves.toBe(ticket)
    expect(updateTicketsReturningMock).not.toHaveBeenCalled()
  })

  it('assigns a new principal, subscribes them, and emits assign/unassign webhook events', async () => {
    const ticket = baseTicket({ assigneePrincipalId: 'principal_old', assigneeTeamId: null })
    const updated = { ...ticket, assigneePrincipalId: 'principal_new', assigneeTeamId: 'team_new' }
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    updateTicketsReturningMock.mockResolvedValueOnce([updated])

    const { assignTicket } = await import('../ticket.service')
    await expect(
      assignTicket('ticket_1' as never, {
        expectedUpdatedAt: ticket.updatedAt,
        actorPrincipalId: 'principal_actor' as never,
        assigneePrincipalId: 'principal_new' as never,
        assigneeTeamId: 'team_new' as never,
        syncSourceIntegrationId: 'github_1',
      })
    ).resolves.toBe(updated)

    expect(safeSubscribeMock).toHaveBeenCalledWith({
      ticketId: 'ticket_1',
      principalId: 'principal_new',
      source: 'auto_assigned',
    })
    expect(notifyTicketAssignedMock).toHaveBeenCalledWith(updated, 'principal_old', {
      actorPrincipalId: 'principal_actor',
    })
    expect(dispatchTicketAssignedMock).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'principal_actor' }),
      updated,
      'principal_old',
      'principal_new',
      { syncSourceIntegrationId: 'github_1' }
    )
    expect(dispatchTicketUnassignedMock).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'principal_actor' }),
      updated,
      'principal_old',
      { syncSourceIntegrationId: 'github_1' }
    )
  })

  it('rejects missing, stale, and concurrently modified assignments', async () => {
    const ticket = baseTicket()
    const { assignTicket } = await import('../ticket.service')

    ticketFindFirstMock.mockResolvedValueOnce(undefined)
    await expect(
      assignTicket('missing' as never, {
        expectedUpdatedAt: ticket.updatedAt,
        actorPrincipalId: null,
        assigneePrincipalId: 'principal_new' as never,
      })
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })

    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    await expect(
      assignTicket('ticket_1' as never, {
        expectedUpdatedAt: new Date('2025-01-01T00:00:00.000Z'),
        actorPrincipalId: null,
        assigneePrincipalId: 'principal_new' as never,
      })
    ).rejects.toMatchObject({ code: 'TICKET_STALE' })

    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    updateTicketsReturningMock.mockResolvedValueOnce([])
    await expect(
      assignTicket('ticket_1' as never, {
        expectedUpdatedAt: ticket.updatedAt,
        actorPrincipalId: null,
        assigneePrincipalId: 'principal_new' as never,
      })
    ).rejects.toMatchObject({ code: 'TICKET_STALE' })
  })
})

describe('softDeleteTicket — webhook dispatch', () => {
  it('rejects missing tickets', async () => {
    ticketFindFirstMock.mockResolvedValueOnce(undefined)
    const { softDeleteTicket } = await import('../ticket.service')
    await expect(softDeleteTicket('missing' as never, null)).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
    })
  })

  it('dispatches ticket.deleted with the actor principal', async () => {
    const ticket = baseTicket()
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    updateTicketsReturningMock.mockResolvedValueOnce([
      { ...ticket, deletedAt: FIXED_NOW, deletedByPrincipalId: 'principal_actor' },
    ])
    const { softDeleteTicket } = await import('../ticket.service')
    await softDeleteTicket('ticket_1' as never, 'principal_actor' as never)
    expect(dispatchTicketDeletedMock).toHaveBeenCalledTimes(1)
    const [, , deletedByPrincipalId] = dispatchTicketDeletedMock.mock.calls[0]
    expect(deletedByPrincipalId).toBe('principal_actor')
  })
})

describe('restoreTicket — webhook dispatch', () => {
  it('rejects missing and not-deleted tickets', async () => {
    const { restoreTicket } = await import('../ticket.service')

    ticketFindFirstMock.mockResolvedValueOnce(undefined)
    await expect(restoreTicket('missing' as never, null)).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
    })

    ticketFindFirstMock.mockResolvedValueOnce(baseTicket({ deletedAt: null }))
    await expect(restoreTicket('ticket_1' as never, null)).rejects.toMatchObject({
      code: 'TICKET_NOT_DELETED',
    })
  })

  it('dispatches ticket.restored with the actor principal', async () => {
    const ticket = baseTicket({ deletedAt: FIXED_NOW, deletedByPrincipalId: 'principal_other' })
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    updateTicketsReturningMock.mockResolvedValueOnce([
      { ...ticket, deletedAt: null, deletedByPrincipalId: null },
    ])
    const { restoreTicket } = await import('../ticket.service')
    await restoreTicket('ticket_1' as never, 'principal_actor' as never)
    expect(dispatchTicketRestoredMock).toHaveBeenCalledTimes(1)
    const [, , restoredByPrincipalId] = dispatchTicketRestoredMock.mock.calls[0]
    expect(restoredByPrincipalId).toBe('principal_actor')
  })

  it('uses service actor and swallows dispatcher errors', async () => {
    const ticket = baseTicket({ deletedAt: FIXED_NOW })
    ticketFindFirstMock.mockResolvedValueOnce(ticket)
    updateTicketsReturningMock.mockResolvedValueOnce([{ ...ticket, deletedAt: null }])
    dispatchTicketRestoredMock.mockRejectedValueOnce(new Error('hook boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { restoreTicket } = await import('../ticket.service')
    const result = await restoreTicket('ticket_1' as never, null)
    expect(result.deletedAt).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('ticket service query helpers', () => {
  it('loads tickets by id and returns early for empty inputs', async () => {
    const ticket = baseTicket({ id: 'ticket_1' })
    const { loadTicketsByIds } = await import('../ticket.service')

    await expect(loadTicketsByIds([])).resolves.toEqual([])

    selectTicketsWhereMock.mockResolvedValueOnce([ticket])
    await expect(loadTicketsByIds(['ticket_1' as never])).resolves.toEqual([ticket])
    expect(selectTicketsWhereMock).toHaveBeenCalled()
  })

  it('bumps last activity without writing a timeline row', async () => {
    const { bumpLastActivity } = await import('../ticket.service')
    await bumpLastActivity('ticket_1' as never)
    expect(insertActivityReturningMock).not.toHaveBeenCalled()
  })
})
