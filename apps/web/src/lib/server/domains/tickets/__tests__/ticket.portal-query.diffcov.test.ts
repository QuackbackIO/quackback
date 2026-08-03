/**
 * Differential-coverage tests for ticket.portal-query — the ownership-gated
 * portal access path (identity resolution, ownership predicate branches,
 * list/get, viewer-relationship resolution, reply/edit/close/reopen guards).
 *
 * All collaborators are mocked: the db (select chain + query.findFirst),
 * principal/contact lookups, thread/ticket mutations, and status listing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// db.select() is used both for awaited list/count queries and as inArray
// subquery arguments. A single chain object handles both: `.where()` returns a
// tail that is thenable (resolves to the count row) AND chainable through
// orderBy/limit/offset (resolves to the rows).
const m = vi.hoisted(() => {
  const offsetMock = vi.fn()
  const tail: Record<string, unknown> = {
    orderBy: () => tail,
    limit: () => tail,
    offset: () => offsetMock(),
    then: (resolve: (v: unknown) => void) => resolve([{ count: 7 }]),
  }
  return {
    ticketsFindFirst: vi.fn(),
    statusesFindFirst: vi.fn(),
    participantsFindFirst: vi.fn(),
    offsetMock,
    selectChain: { from: () => ({ where: () => tail }) },
  }
})
const { ticketsFindFirst, statusesFindFirst, participantsFindFirst, offsetMock } = m

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn(() => m.selectChain),
    query: {
      tickets: { findFirst: m.ticketsFindFirst },
      ticketStatuses: { findFirst: m.statusesFindFirst },
      ticketParticipants: { findFirst: m.participantsFindFirst },
    },
  },
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...a) => ({ and: a })),
  or: vi.fn((...a) => ({ or: a })),
  isNull: vi.fn((a) => ({ isNull: a })),
  inArray: vi.fn((a, b) => ({ inArray: [a, b] })),
  desc: vi.fn((a) => a),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  tickets: {
    id: 'tickets.id',
    requesterPrincipalId: 'tickets.requesterPrincipalId',
    requesterContactId: 'tickets.requesterContactId',
    deletedAt: 'tickets.deletedAt',
    statusId: 'tickets.statusId',
    sourceWidgetProfileId: 'tickets.sourceWidgetProfileId',
    inboxId: 'tickets.inboxId',
    lastActivityAt: 'tickets.lastActivityAt',
  },
  ticketStatuses: { id: 'ticketStatuses.id', category: 'ticketStatuses.category' },
  ticketParticipants: {
    ticketId: 'tp.ticketId',
    principalId: 'tp.principalId',
    contactId: 'tp.contactId',
  },
}))

const getMemberByUser = vi.fn()
const listLinksForUser = vi.fn()
const addThread = vi.fn()
const updateTicket = vi.fn()
const transitionStatus = vi.fn()
const listTicketStatuses = vi.fn()

vi.mock('../../principals/principal.service', () => ({
  getMemberByUser: (...a: unknown[]) => getMemberByUser(...a),
}))
vi.mock('../../organizations/contact.service', () => ({
  listLinksForUser: (...a: unknown[]) => listLinksForUser(...a),
}))
vi.mock('../ticket.threads', () => ({ addThread: (...a: unknown[]) => addThread(...a) }))
vi.mock('../ticket.service', () => ({
  updateTicket: (...a: unknown[]) => updateTicket(...a),
  transitionStatus: (...a: unknown[]) => transitionStatus(...a),
}))
vi.mock('../ticket-statuses.service', () => ({
  listTicketStatuses: (...a: unknown[]) => listTicketStatuses(...a),
}))

import {
  buildPortalIdentity,
  listTicketsForPortalUser,
  getTicketForPortalUser,
  resolveViewerRelationship,
  addPortalReply,
  updatePortalTicketDescription,
  closePortalTicket,
  reopenPortalTicket,
} from '../ticket.portal-query'

const uid = 'user_1' as never

beforeEach(() => {
  vi.clearAllMocks()
  getMemberByUser.mockResolvedValue({ id: 'principal_1' })
  listLinksForUser.mockResolvedValue([{ contactId: 'contact_1' }, { contactId: 'contact_1' }])
  offsetMock.mockResolvedValue([{ id: 'ticket_1' }])
  listTicketStatuses.mockResolvedValue([
    { id: 'st_open', category: 'open' },
    { id: 'st_solved', category: 'solved' },
  ])
})

describe('buildPortalIdentity', () => {
  it('dedupes linked contacts and resolves the principal', async () => {
    const id = await buildPortalIdentity(uid)
    expect(id).toEqual({ principalId: 'principal_1', contactIds: ['contact_1'] })
  })

  it('returns a null principal when no member row exists', async () => {
    getMemberByUser.mockResolvedValueOnce(undefined)
    const id = await buildPortalIdentity(uid)
    expect(id.principalId).toBeNull()
  })
})

describe('listTicketsForPortalUser', () => {
  it('returns empty when the identity is empty (no ownership predicate)', async () => {
    getMemberByUser.mockResolvedValueOnce(null)
    listLinksForUser.mockResolvedValueOnce([])
    const res = await listTicketsForPortalUser({ userId: uid })
    expect(res).toEqual({ rows: [], total: 0 })
  })

  it('lists with status/widget filters and clamps the limit', async () => {
    const res = await listTicketsForPortalUser({
      userId: uid,
      statusCategory: 'open' as never,
      sourceWidgetProfileId: 'wp_1' as never,
      limit: 9999,
      offset: -5,
    })
    expect(res).toEqual({ rows: [{ id: 'ticket_1' }], total: 7 })
  })

  it('short-circuits to empty when allowedInboxIds is an empty list', async () => {
    const res = await listTicketsForPortalUser({ userId: uid, allowedInboxIds: [] })
    expect(res).toEqual({ rows: [], total: 0 })
  })

  it('applies a non-empty allowedInboxIds filter', async () => {
    const res = await listTicketsForPortalUser({
      userId: uid,
      allowedInboxIds: ['inbox_1'] as never,
    })
    expect(res.total).toBe(7)
  })

  it('builds an ownership predicate from contacts only', async () => {
    getMemberByUser.mockResolvedValueOnce(null)
    const res = await listTicketsForPortalUser({ userId: uid })
    expect(res.total).toBe(7)
  })
})

describe('getTicketForPortalUser', () => {
  it('throws NotFound when identity is empty', async () => {
    getMemberByUser.mockResolvedValueOnce(null)
    listLinksForUser.mockResolvedValueOnce([])
    await expect(getTicketForPortalUser({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'not found'
    )
  })

  it('throws NotFound when the row is missing', async () => {
    ticketsFindFirst.mockResolvedValueOnce(undefined)
    await expect(getTicketForPortalUser({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'not found'
    )
  })

  it('returns the ticket when found', async () => {
    ticketsFindFirst.mockResolvedValueOnce({ id: 't1' })
    const row = await getTicketForPortalUser({ userId: uid, ticketId: 't1' as never })
    expect(row).toEqual({ id: 't1' })
  })
})

describe('resolveViewerRelationship', () => {
  const identity = { principalId: 'principal_1', contactIds: ['contact_1'] } as never

  it('returns requester when the principal matches', async () => {
    const rel = await resolveViewerRelationship(
      { id: 't1', requesterPrincipalId: 'principal_1' } as never,
      identity
    )
    expect(rel).toBe('requester')
  })

  it('returns requester when a linked contact matches', async () => {
    const rel = await resolveViewerRelationship(
      { id: 't1', requesterPrincipalId: 'other', requesterContactId: 'contact_1' } as never,
      identity
    )
    expect(rel).toBe('requester')
  })

  it('looks up the participant role when not the requester', async () => {
    participantsFindFirst.mockResolvedValueOnce({ role: 'collaborator' })
    const rel = await resolveViewerRelationship({ id: 't1' } as never, identity)
    expect(rel).toBe('collaborator')
  })

  it('falls back to watcher when no participant row is found', async () => {
    participantsFindFirst.mockResolvedValueOnce(undefined)
    const rel = await resolveViewerRelationship({ id: 't1' } as never, identity)
    expect(rel).toBe('watcher')
  })

  it('returns watcher immediately when the identity is empty', async () => {
    const rel = await resolveViewerRelationship(
      { id: 't1' } as never,
      { principalId: null, contactIds: [] } as never
    )
    expect(rel).toBe('watcher')
    expect(participantsFindFirst).not.toHaveBeenCalled()
  })
})

describe('addPortalReply', () => {
  it('rejects replies to a closed ticket', async () => {
    ticketsFindFirst.mockResolvedValueOnce({ id: 't1', statusId: 'st_closed' })
    statusesFindFirst.mockResolvedValueOnce({ category: 'closed' })
    await expect(addPortalReply({ userId: uid, ticketId: 't1' as never })).rejects.toThrow('closed')
  })

  it('throws when the portal user has no principal', async () => {
    ticketsFindFirst.mockResolvedValueOnce({ id: 't1', requesterPrincipalId: 'principal_1' })
    getMemberByUser.mockResolvedValueOnce({ id: 'principal_1' }) // for getTicketForPortalUser identity
    getMemberByUser.mockResolvedValueOnce(undefined) // the explicit member check
    await expect(addPortalReply({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'no principal'
    )
  })

  it('denies a watcher and allows a requester', async () => {
    // watcher: ticket has no requester match + participant role watcher
    ticketsFindFirst.mockResolvedValueOnce({ id: 't1', statusId: null })
    participantsFindFirst.mockResolvedValueOnce({ role: 'watcher' })
    await expect(addPortalReply({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'cannot reply'
    )

    // requester: principal matches → reply created
    ticketsFindFirst.mockResolvedValueOnce({
      id: 't1',
      statusId: null,
      requesterPrincipalId: 'principal_1',
    })
    addThread.mockResolvedValueOnce({ id: 'thread_1' })
    const thread = await addPortalReply({
      userId: uid,
      ticketId: 't1' as never,
      bodyText: 'hi',
    })
    expect(thread).toEqual({ id: 'thread_1' })
  })
})

describe('updatePortalTicketDescription', () => {
  it('rejects edits to a closed ticket', async () => {
    ticketsFindFirst.mockResolvedValueOnce({ id: 't1', statusId: 'st_closed' })
    statusesFindFirst.mockResolvedValueOnce({ category: 'closed' })
    await expect(
      updatePortalTicketDescription({
        userId: uid,
        ticketId: 't1' as never,
        expectedUpdatedAt: new Date(),
      })
    ).rejects.toThrow('closed')
  })

  it('denies a non-requester/collaborator role', async () => {
    ticketsFindFirst.mockResolvedValueOnce({ id: 't1', statusId: null })
    participantsFindFirst.mockResolvedValueOnce({ role: 'cc' })
    await expect(
      updatePortalTicketDescription({
        userId: uid,
        ticketId: 't1' as never,
        expectedUpdatedAt: new Date(),
      })
    ).rejects.toThrow('cannot edit')
  })

  it('updates the description for the requester', async () => {
    ticketsFindFirst.mockResolvedValueOnce({
      id: 't1',
      statusId: null,
      requesterPrincipalId: 'principal_1',
    })
    updateTicket.mockResolvedValueOnce({ id: 't1' })
    const res = await updatePortalTicketDescription({
      userId: uid,
      ticketId: 't1' as never,
      expectedUpdatedAt: new Date('2026-01-01'),
      descriptionText: 'x',
    })
    expect(res).toEqual({ id: 't1' })
    expect(updateTicket).toHaveBeenCalled()
  })
})

describe('closePortalTicket', () => {
  it('denies a non-requester', async () => {
    ticketsFindFirst.mockResolvedValueOnce({ id: 't1' })
    participantsFindFirst.mockResolvedValueOnce({ role: 'collaborator' })
    await expect(closePortalTicket({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'requester'
    )
  })

  it('rejects when the ticket is not in an active category', async () => {
    ticketsFindFirst.mockResolvedValueOnce({
      id: 't1',
      requesterPrincipalId: 'principal_1',
      statusId: 'st_solved',
    })
    statusesFindFirst.mockResolvedValueOnce({ category: 'solved' })
    await expect(closePortalTicket({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'not in an active state'
    )
  })

  it('transitions an active ticket to the solved status', async () => {
    ticketsFindFirst.mockResolvedValueOnce({
      id: 't1',
      requesterPrincipalId: 'principal_1',
      statusId: 'st_open',
      updatedAt: new Date('2026-01-01'),
    })
    statusesFindFirst.mockResolvedValueOnce({ category: 'open' })
    transitionStatus.mockResolvedValueOnce({ id: 't1' })
    const res = await closePortalTicket({ userId: uid, ticketId: 't1' as never })
    expect(res).toEqual({ id: 't1' })
    expect(transitionStatus).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ statusId: 'st_solved' })
    )
  })

  it('throws when no solved status is configured', async () => {
    ticketsFindFirst.mockResolvedValueOnce({
      id: 't1',
      requesterPrincipalId: 'principal_1',
      statusId: 'st_open',
      updatedAt: new Date(),
    })
    statusesFindFirst.mockResolvedValueOnce({ category: 'open' })
    listTicketStatuses.mockResolvedValueOnce([{ id: 'st_open', category: 'open' }])
    await expect(closePortalTicket({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'no solved status'
    )
  })
})

describe('reopenPortalTicket', () => {
  it('denies a non-requester', async () => {
    ticketsFindFirst.mockResolvedValueOnce({ id: 't1' })
    participantsFindFirst.mockResolvedValueOnce({ role: 'collaborator' })
    await expect(reopenPortalTicket({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'requester'
    )
  })

  it('rejects when the ticket is not solved', async () => {
    ticketsFindFirst.mockResolvedValueOnce({
      id: 't1',
      requesterPrincipalId: 'principal_1',
      statusId: 'st_open',
    })
    statusesFindFirst.mockResolvedValueOnce({ category: 'open' })
    await expect(reopenPortalTicket({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'only solved tickets'
    )
  })

  it('reopens a solved ticket to the first open status', async () => {
    ticketsFindFirst.mockResolvedValueOnce({
      id: 't1',
      requesterPrincipalId: 'principal_1',
      statusId: 'st_solved',
      updatedAt: new Date(),
    })
    statusesFindFirst.mockResolvedValueOnce({ category: 'solved' })
    transitionStatus.mockResolvedValueOnce({ id: 't1' })
    const res = await reopenPortalTicket({ userId: uid, ticketId: 't1' as never })
    expect(transitionStatus).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ statusId: 'st_open' })
    )
    expect(res).toEqual({ id: 't1' })
  })

  it('throws when no open status is configured', async () => {
    ticketsFindFirst.mockResolvedValueOnce({
      id: 't1',
      requesterPrincipalId: 'principal_1',
      statusId: 'st_solved',
      updatedAt: new Date(),
    })
    statusesFindFirst.mockResolvedValueOnce({ category: 'solved' })
    listTicketStatuses.mockResolvedValueOnce([{ id: 'st_solved', category: 'solved' }])
    await expect(reopenPortalTicket({ userId: uid, ticketId: 't1' as never })).rejects.toThrow(
      'no open status'
    )
  })
})
