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
const recordEventMock = vi.fn()
const findOrCreateByEmailMock = vi.fn()
const linkContactToUserMock = vi.fn()
const listLinksForUserMock = vi.fn()
const getContactMock = vi.fn()
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
      select: vi.fn(),
      delete: vi.fn(),
    },
    eq: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
    inArray: vi.fn(),
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
  findOrCreateByEmailMock.mockReset()
  linkContactToUserMock.mockReset()
  listLinksForUserMock.mockReset().mockResolvedValue([])
  getContactMock.mockReset().mockResolvedValue(null)
  ticketInsertValuesCalls.length = 0
  insertActivityReturningMock.mockResolvedValue([{ id: 'ticket_act_x' }])
  recordEventMock.mockReset()
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
})

describe('softDeleteTicket — webhook dispatch', () => {
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
