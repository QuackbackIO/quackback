/**
 * Portal-side ticket query — ownership predicate + access negative paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getMemberByUserMock = vi.fn()
const listLinksForUserMock = vi.fn()
const addThreadMock = vi.fn()

const ticketsFindFirstMock = vi.fn()
const ticketStatusesFindFirstMock = vi.fn()
const ticketParticipantsFindFirstMock = vi.fn()
const rowsResultMock = vi.fn<() => unknown[]>()
const countResultMock = vi.fn<() => Array<{ count: number }>>()
/** Captures the WHERE arg for top-level rows / count queries (in call order). */
const capturedWhereCalls: Array<{ kind: 'rows' | 'count'; where: any }> = []

vi.mock('../../principals/principal.service', () => ({
  getMemberByUser: (...args: unknown[]) => getMemberByUserMock(...args),
}))

vi.mock('../../organizations/contact.service', () => ({
  listLinksForUser: (...args: unknown[]) => listLinksForUserMock(...args),
}))

vi.mock('../ticket.threads', () => ({
  addThread: (...args: unknown[]) => addThreadMock(...args),
}))

vi.mock('@/lib/server/db', () => {
  // Each `db.select()` produces a fresh chain. Whether it ends up being the
  // ROWS query (.limit().offset() awaited) or the COUNT query (.where() awaited
  // directly) is decided by which terminator the caller uses.
  function makeChain() {
    const chain: any = {}
    let lastWhere: any = null
    let isFromTickets = false
    chain.from = vi.fn((tbl: any) => {
      isFromTickets = tbl?._name === 'tickets'
      return chain
    })
    chain.where = vi.fn((arg: any) => {
      lastWhere = arg
      // Make the chain thenable so the count query (awaits after .where) works.
      // Only do this for top-level queries (from tickets); subqueries are passed
      // opaquely into inArray() and never awaited.
      if (isFromTickets) {
        chain.then = (resolve: (v: unknown) => unknown) => {
          capturedWhereCalls.push({ kind: 'count', where: lastWhere })
          return Promise.resolve(countResultMock()).then(resolve)
        }
      }
      return chain
    })
    chain.orderBy = vi.fn(() => chain)
    chain.limit = vi.fn(() => chain)
    chain.offset = vi.fn(() => {
      // Once .offset() is called we know this is the rows query — strip the
      // count thenable and resolve to row data instead.
      delete chain.then
      capturedWhereCalls.push({ kind: 'rows', where: lastWhere })
      return Promise.resolve(rowsResultMock())
    })
    return chain
  }

  return {
    db: {
      query: {
        tickets: { findFirst: ticketsFindFirstMock },
        ticketStatuses: { findFirst: ticketStatusesFindFirstMock },
        ticketParticipants: { findFirst: ticketParticipantsFindFirstMock },
      },
      select: vi.fn(() => makeChain()),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    eq: vi.fn((col, val) => ({ _op: 'eq', col, val })),
    and: vi.fn((...args) => ({ _op: 'and', args })),
    or: vi.fn((...args) => ({ _op: 'or', args })),
    isNull: vi.fn((col) => ({ _op: 'isNull', col })),
    inArray: vi.fn((col, vals) => ({ _op: 'inArray', col, vals })),
    desc: vi.fn(),
    asc: vi.fn(),
    sql: Object.assign(
      vi.fn(() => 'sql_frag'),
      { raw: vi.fn() }
    ),
    tickets: {
      _name: 'tickets',
      id: 'tickets.id',
      requesterPrincipalId: 'tickets.requester_principal_id',
      requesterContactId: 'tickets.requester_contact_id',
      statusId: 'tickets.status_id',
      deletedAt: 'tickets.deleted_at',
      lastActivityAt: 'tickets.last_activity_at',
    },
    ticketStatuses: {
      _name: 'ticket_statuses',
      id: 'ticket_statuses.id',
      category: 'ticket_statuses.category',
    },
    ticketParticipants: {
      _name: 'ticket_participants',
      ticketId: 'ticket_participants.ticket_id',
      principalId: 'ticket_participants.principal_id',
      contactId: 'ticket_participants.contact_id',
    },
  }
})

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
  getMemberByUserMock.mockReset()
  listLinksForUserMock.mockReset()
  addThreadMock.mockReset()
  ticketsFindFirstMock.mockReset()
  ticketStatusesFindFirstMock.mockReset()
  ticketParticipantsFindFirstMock.mockReset()
  rowsResultMock.mockReset()
  countResultMock.mockReset()
  capturedWhereCalls.length = 0
  rowsResultMock.mockReturnValue([])
  countResultMock.mockReturnValue([{ count: 0 }])
})

function findOwnership(): any {
  const top = capturedWhereCalls.find((c) => c.kind === 'rows')
  if (!top) return null
  // top.where = and(isNull(deletedAt), ownership, [statusFilter?])
  const andArgs: any[] = top.where?.args ?? []
  return andArgs.find((a) => a?._op === 'or' || a?._op === 'eq' || a?._op === 'inArray')
}

function ownershipBranches(): any[] {
  const o = findOwnership()
  if (!o) return []
  return o._op === 'or' ? o.args : [o]
}

describe('listTicketsForPortalUser', () => {
  it('returns empty without DB hit when identity is empty', async () => {
    getMemberByUserMock.mockResolvedValueOnce(null)
    listLinksForUserMock.mockResolvedValueOnce([])
    const { listTicketsForPortalUser } = await import('../ticket.portal-query')
    const result = await listTicketsForPortalUser({ userId: 'user_x' as never })
    expect(result).toEqual({ rows: [], total: 0 })
    expect(rowsResultMock).not.toHaveBeenCalled()
  })

  it('builds a requester-principal branch when only principal is present', async () => {
    getMemberByUserMock.mockResolvedValueOnce({ id: 'principal_1' })
    listLinksForUserMock.mockResolvedValueOnce([])
    rowsResultMock.mockReturnValue([{ id: 'ticket_1' }])
    countResultMock.mockReturnValue([{ count: 1 }])
    const { listTicketsForPortalUser } = await import('../ticket.portal-query')
    const result = await listTicketsForPortalUser({ userId: 'user_1' as never })
    expect(result.total).toBe(1)
    const branches = ownershipBranches()
    expect(
      branches.some(
        (b) =>
          b?._op === 'eq' && b.col === 'tickets.requester_principal_id' && b.val === 'principal_1'
      )
    ).toBe(true)
  })

  it('builds a contact branch when only links are present', async () => {
    getMemberByUserMock.mockResolvedValueOnce(null)
    listLinksForUserMock.mockResolvedValueOnce([
      { contactId: 'contact_a' },
      { contactId: 'contact_b' },
    ])
    const { listTicketsForPortalUser } = await import('../ticket.portal-query')
    await listTicketsForPortalUser({ userId: 'user_2' as never })
    const branches = ownershipBranches()
    expect(
      branches.some(
        (b) =>
          b?._op === 'inArray' &&
          b.col === 'tickets.requester_contact_id' &&
          Array.isArray(b.vals) &&
          b.vals.length === 2
      )
    ).toBe(true)
  })

  it('includes the participant subquery branch when identity is non-empty', async () => {
    getMemberByUserMock.mockResolvedValueOnce({ id: 'principal_3' })
    listLinksForUserMock.mockResolvedValueOnce([])
    const { listTicketsForPortalUser } = await import('../ticket.portal-query')
    await listTicketsForPortalUser({ userId: 'user_3' as never })
    const branches = ownershipBranches()
    expect(branches.some((b) => b?._op === 'inArray' && b.col === 'tickets.id')).toBe(true)
  })
})

describe('getTicketForPortalUser', () => {
  it('throws NotFoundError when identity is empty', async () => {
    getMemberByUserMock.mockResolvedValueOnce(null)
    listLinksForUserMock.mockResolvedValueOnce([])
    const { getTicketForPortalUser } = await import('../ticket.portal-query')
    await expect(
      getTicketForPortalUser({ userId: 'user_x' as never, ticketId: 'ticket_1' as never })
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
    expect(ticketsFindFirstMock).not.toHaveBeenCalled()
  })

  it('throws NotFoundError (not Forbidden) when predicate misses', async () => {
    getMemberByUserMock.mockResolvedValueOnce({ id: 'principal_1' })
    listLinksForUserMock.mockResolvedValueOnce([])
    ticketsFindFirstMock.mockResolvedValueOnce(undefined)
    const { getTicketForPortalUser } = await import('../ticket.portal-query')
    await expect(
      getTicketForPortalUser({ userId: 'user_1' as never, ticketId: 'ticket_1' as never })
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
  })

  it('returns the ticket when ownership matches', async () => {
    getMemberByUserMock.mockResolvedValueOnce({ id: 'principal_1' })
    listLinksForUserMock.mockResolvedValueOnce([])
    ticketsFindFirstMock.mockResolvedValueOnce({ id: 'ticket_1', subject: 'Hi' })
    const { getTicketForPortalUser } = await import('../ticket.portal-query')
    const t = await getTicketForPortalUser({
      userId: 'user_1' as never,
      ticketId: 'ticket_1' as never,
    })
    expect(t.id).toBe('ticket_1')
  })
})

describe('addPortalReply', () => {
  it('rejects when status category is closed', async () => {
    getMemberByUserMock.mockResolvedValue({ id: 'principal_1' })
    listLinksForUserMock.mockResolvedValue([])
    ticketsFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_1',
      statusId: 'ticket_status_closed',
    })
    ticketStatusesFindFirstMock.mockResolvedValueOnce({ category: 'closed' })
    const { addPortalReply } = await import('../ticket.portal-query')
    await expect(
      addPortalReply({
        userId: 'user_1' as never,
        ticketId: 'ticket_1' as never,
        bodyText: 'hi',
      })
    ).rejects.toMatchObject({ code: 'TICKET_CLOSED' })
    expect(addThreadMock).not.toHaveBeenCalled()
  })

  it('calls addThread with audience=public and the user principal', async () => {
    getMemberByUserMock.mockResolvedValue({ id: 'principal_1' })
    listLinksForUserMock.mockResolvedValue([])
    ticketsFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_1',
      statusId: 'ticket_status_open',
    })
    ticketStatusesFindFirstMock.mockResolvedValueOnce({ category: 'open' })
    ticketParticipantsFindFirstMock.mockResolvedValueOnce({ role: 'collaborator' })
    addThreadMock.mockResolvedValueOnce({ id: 'thread_1', audience: 'public' })
    const { addPortalReply } = await import('../ticket.portal-query')
    const result = await addPortalReply({
      userId: 'user_1' as never,
      ticketId: 'ticket_1' as never,
      bodyText: 'hi',
    })
    expect(result.id).toBe('thread_1')
    expect(addThreadMock).toHaveBeenCalledWith({
      ticketId: 'ticket_1',
      principalId: 'principal_1',
      audience: 'public',
      bodyJson: null,
      bodyText: 'hi',
    })
  })
})
