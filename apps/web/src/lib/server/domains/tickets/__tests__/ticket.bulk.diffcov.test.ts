/**
 * Differential-coverage tests for ticket.bulk — focuses on bulkAssign,
 * bulkTransition, and the errReason helper (the not-found / forbidden /
 * success / error branches that the existing bulkChangeInbox suite leaves
 * uncovered).
 *
 * Mirrors the mocking conventions in ticket.bulk.test.ts: the db chain,
 * share lookups, the assignTicket/transitionStatus delegates, and the
 * dispatcher are all mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const selectFromWhereMock = vi.fn()

const assignTicketMock = vi.fn()
const transitionStatusMock = vi.fn()
const listSharesForTicketMock = vi.fn()
const permitMock = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: selectFromWhereMock })),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    })),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  tickets: { _name: 'tickets', id: 'tickets.id', updatedAt: 'tickets.updatedAt' },
}))

vi.mock('../../audit', () => ({ recordEvent: vi.fn() }))
vi.mock('../', () => ({
  assignTicket: (...a: unknown[]) => assignTicketMock(...a),
  transitionStatus: (...a: unknown[]) => transitionStatusMock(...a),
  toResourceScope: vi.fn(() => ({ primaryTeamId: null })),
}))
vi.mock('../ticket.share', () => ({
  listSharesForTicket: (...a: unknown[]) => listSharesForTicketMock(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
  selectFromWhereMock.mockReset()
  assignTicketMock.mockReset().mockResolvedValue(undefined)
  transitionStatusMock.mockReset().mockResolvedValue(undefined)
  listSharesForTicketMock.mockReset().mockResolvedValue([])
  permitMock.mockReset().mockReturnValue(true)
})

const row = (id: string) => ({
  id,
  updatedAt: new Date('2026-04-01'),
  primaryTeamId: null,
  assigneePrincipalId: null,
  assigneeTeamId: null,
  inboxId: null,
})

describe('bulkAssign', () => {
  it('handles success, not-found, and error rows in one batch', async () => {
    // db returns rows for ticket_ok + ticket_err (in that order); ticket_missing
    // is absent so it resolves to TICKET_NOT_FOUND.
    selectFromWhereMock.mockResolvedValueOnce([row('ticket_ok'), row('ticket_err')])
    listSharesForTicketMock.mockResolvedValue([])
    // Rows are processed in order: assignTicket call #1 (ticket_ok) succeeds,
    // call #2 (ticket_err) throws a coded error -> errReason uses the code.
    assignTicketMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'CONFLICT' }))

    const { bulkAssign } = await import('../ticket.bulk')
    const result = await bulkAssign({
      ticketIds: ['ticket_ok', 'ticket_missing', 'ticket_err'] as never,
      actorPrincipalId: 'user_a' as never,
      assigneePrincipalId: 'user_target' as never,
      assigneeTeamId: null,
      permit: (() => true) as never,
    })

    expect(result.succeeded).toEqual([{ ticketId: 'ticket_ok' }])
    expect(result.failed).toContainEqual({ ticketId: 'ticket_missing', reason: 'TICKET_NOT_FOUND' })
    expect(result.failed).toContainEqual({ ticketId: 'ticket_err', reason: 'CONFLICT' })
  })

  it('marks a row FORBIDDEN when permit returns false', async () => {
    selectFromWhereMock.mockResolvedValueOnce([row('ticket_1')])
    const { bulkAssign } = await import('../ticket.bulk')
    const result = await bulkAssign({
      ticketIds: ['ticket_1'] as never,
      actorPrincipalId: 'user_a' as never,
      assigneePrincipalId: null,
      assigneeTeamId: 'team_x' as never,
      permit: (() => false) as never,
    })
    expect(result.failed).toEqual([{ ticketId: 'ticket_1', reason: 'FORBIDDEN' }])
    expect(result.succeeded).toEqual([])
    expect(assignTicketMock).not.toHaveBeenCalled()
  })

  it('returns empty result for an empty ticketIds list (loadTicketsForBulk short-circuit)', async () => {
    const { bulkAssign } = await import('../ticket.bulk')
    const result = await bulkAssign({
      ticketIds: [] as never,
      actorPrincipalId: 'user_a' as never,
      assigneePrincipalId: null,
      assigneeTeamId: null,
      permit: (() => true) as never,
    })
    expect(result).toEqual({ succeeded: [], failed: [] })
    // db.select(...).from(...).where was never called because of the length===0 guard.
    expect(selectFromWhereMock).not.toHaveBeenCalled()
  })

  it('passes assignment params through and records success', async () => {
    selectFromWhereMock.mockResolvedValueOnce([row('ticket_1')])
    const { bulkAssign } = await import('../ticket.bulk')
    const result = await bulkAssign({
      ticketIds: ['ticket_1'] as never,
      actorPrincipalId: 'user_a' as never,
      assigneePrincipalId: 'user_b' as never,
      assigneeTeamId: null,
      permit: (() => true) as never,
    })
    expect(result.succeeded).toEqual([{ ticketId: 'ticket_1' }])
    expect(assignTicketMock).toHaveBeenCalledWith('ticket_1', {
      expectedUpdatedAt: new Date('2026-04-01'),
      actorPrincipalId: 'user_a',
      assigneePrincipalId: 'user_b',
      assigneeTeamId: null,
    })
  })
})

describe('bulkTransition', () => {
  it('handles success, not-found, forbidden, and error rows', async () => {
    selectFromWhereMock.mockResolvedValueOnce([row('ticket_ok'), row('ticket_err')])
    transitionStatusMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('stale write'))

    const { bulkTransition } = await import('../ticket.bulk')
    const result = await bulkTransition({
      ticketIds: ['ticket_ok', 'ticket_missing', 'ticket_err'] as never,
      actorPrincipalId: 'user_a' as never,
      statusId: 'status_done' as never,
      permit: (() => true) as never,
    })

    expect(result.succeeded).toEqual([{ ticketId: 'ticket_ok' }])
    expect(result.failed).toContainEqual({ ticketId: 'ticket_missing', reason: 'TICKET_NOT_FOUND' })
    // Error without a `code` falls back to the Error.message branch of errReason.
    expect(result.failed).toContainEqual({ ticketId: 'ticket_err', reason: 'stale write' })
    expect(transitionStatusMock).toHaveBeenCalledWith('ticket_ok', {
      expectedUpdatedAt: new Date('2026-04-01'),
      actorPrincipalId: 'user_a',
      statusId: 'status_done',
    })
  })

  it('marks a row FORBIDDEN when permit returns false', async () => {
    selectFromWhereMock.mockResolvedValueOnce([row('ticket_1')])
    const { bulkTransition } = await import('../ticket.bulk')
    const result = await bulkTransition({
      ticketIds: ['ticket_1'] as never,
      actorPrincipalId: 'user_a' as never,
      statusId: 'status_done' as never,
      permit: (() => false) as never,
    })
    expect(result.failed).toEqual([{ ticketId: 'ticket_1', reason: 'FORBIDDEN' }])
    expect(transitionStatusMock).not.toHaveBeenCalled()
  })

  it('returns empty result for an empty ticketIds list', async () => {
    const { bulkTransition } = await import('../ticket.bulk')
    const result = await bulkTransition({
      ticketIds: [] as never,
      actorPrincipalId: 'user_a' as never,
      statusId: 'status_done' as never,
      permit: (() => true) as never,
    })
    expect(result).toEqual({ succeeded: [], failed: [] })
  })
})

describe('errReason (exercised via bulkTransition error path)', () => {
  it('uses the error code when present', async () => {
    selectFromWhereMock.mockResolvedValueOnce([row('ticket_1')])
    transitionStatusMock.mockRejectedValueOnce({ code: 'OPTIMISTIC_LOCK' })
    const { bulkTransition } = await import('../ticket.bulk')
    const result = await bulkTransition({
      ticketIds: ['ticket_1'] as never,
      actorPrincipalId: 'user_a' as never,
      statusId: 'status_done' as never,
      permit: (() => true) as never,
    })
    expect(result.failed).toEqual([{ ticketId: 'ticket_1', reason: 'OPTIMISTIC_LOCK' }])
  })

  it('falls back to Error.message when there is no code', async () => {
    selectFromWhereMock.mockResolvedValueOnce([row('ticket_1')])
    transitionStatusMock.mockRejectedValueOnce(new Error('plain error'))
    const { bulkTransition } = await import('../ticket.bulk')
    const result = await bulkTransition({
      ticketIds: ['ticket_1'] as never,
      actorPrincipalId: 'user_a' as never,
      statusId: 'status_done' as never,
      permit: (() => true) as never,
    })
    expect(result.failed).toEqual([{ ticketId: 'ticket_1', reason: 'plain error' }])
  })

  it('falls back to UNKNOWN for a non-error, non-coded throw', async () => {
    selectFromWhereMock.mockResolvedValueOnce([row('ticket_1')])
    transitionStatusMock.mockRejectedValueOnce('a bare string')
    const { bulkTransition } = await import('../ticket.bulk')
    const result = await bulkTransition({
      ticketIds: ['ticket_1'] as never,
      actorPrincipalId: 'user_a' as never,
      statusId: 'status_done' as never,
      permit: (() => true) as never,
    })
    expect(result.failed).toEqual([{ ticketId: 'ticket_1', reason: 'UNKNOWN' }])
  })

  it('treats an object with a non-string code as UNKNOWN', async () => {
    selectFromWhereMock.mockResolvedValueOnce([row('ticket_1')])
    transitionStatusMock.mockRejectedValueOnce({ code: 42 })
    const { bulkTransition } = await import('../ticket.bulk')
    const result = await bulkTransition({
      ticketIds: ['ticket_1'] as never,
      actorPrincipalId: 'user_a' as never,
      statusId: 'status_done' as never,
      permit: (() => true) as never,
    })
    expect(result.failed).toEqual([{ ticketId: 'ticket_1', reason: 'UNKNOWN' }])
  })
})
