/**
 * Phase 4: bulkChangeInbox dispatches one ticket.updated per affected ticket.
 *
 * Mocks the db, share lookups, and the dispatcher itself; verifies that
 * succeeded rows trigger a dispatch and that not-found / stale / forbidden
 * rows do not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const selectFromWhereMock = vi.fn()
const updateReturningMock = vi.fn()

const dispatchTicketUpdatedMock = vi.fn()
const buildEventActorMock = vi.fn((input: { principalId: string }) => ({
  type: 'user' as const,
  principalId: input.principalId,
  displayName: 'ticket-system',
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: selectFromWhereMock })),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: updateReturningMock,
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
  assignTicket: vi.fn(),
  transitionStatus: vi.fn(),
  toResourceScope: vi.fn(() => ({ primaryTeamId: null })),
}))
vi.mock('../ticket.share', () => ({ listSharesForTicket: vi.fn().mockResolvedValue([]) }))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchTicketUpdated: (...a: unknown[]) => dispatchTicketUpdatedMock(...a),
  buildEventActor: (...a: unknown[]) => buildEventActorMock(...(a as [{ principalId: string }])),
}))

beforeEach(() => {
  vi.clearAllMocks()
  selectFromWhereMock.mockReset()
  updateReturningMock.mockReset()
  dispatchTicketUpdatedMock.mockReset()
})

describe('bulkChangeInbox → dispatchTicketUpdated', () => {
  it('fires one dispatch per succeeded ticket and skips not-found rows', async () => {
    selectFromWhereMock.mockResolvedValueOnce([
      { id: 'ticket_1', inboxId: 'inbox_old', updatedAt: new Date('2026-04-01') },
      { id: 'ticket_2', inboxId: 'inbox_old', updatedAt: new Date('2026-04-01') },
    ])
    updateReturningMock
      .mockResolvedValueOnce([{ id: 'ticket_1', inboxId: 'inbox_new' }])
      .mockResolvedValueOnce([{ id: 'ticket_2', inboxId: 'inbox_new' }])

    const { bulkChangeInbox } = await import('../ticket.bulk')
    const result = await bulkChangeInbox({
      ticketIds: ['ticket_1', 'ticket_2', 'ticket_missing'] as never,
      actorPrincipalId: 'user_a' as never,
      inboxId: 'inbox_new' as never,
      permit: () => true,
    })
    expect(result.succeeded.map((s) => s.ticketId)).toEqual(['ticket_1', 'ticket_2'])
    expect(result.failed).toEqual([{ ticketId: 'ticket_missing', reason: 'TICKET_NOT_FOUND' }])
    expect(dispatchTicketUpdatedMock).toHaveBeenCalledTimes(2)
    const [, ticket, changedFields, diff] = dispatchTicketUpdatedMock.mock.calls[0]
    expect((ticket as { id: string }).id).toBe('ticket_1')
    expect(changedFields).toEqual(['inboxId'])
    expect(diff).toEqual({ inboxId: { from: 'inbox_old', to: 'inbox_new' } })
  })

  it('does not dispatch for forbidden rows', async () => {
    selectFromWhereMock.mockResolvedValueOnce([
      { id: 'ticket_1', inboxId: 'inbox_old', updatedAt: new Date('2026-04-01') },
    ])
    const { bulkChangeInbox } = await import('../ticket.bulk')
    const result = await bulkChangeInbox({
      ticketIds: ['ticket_1'] as never,
      actorPrincipalId: 'user_a' as never,
      inboxId: 'inbox_new' as never,
      permit: () => false,
    })
    expect(result.failed).toEqual([{ ticketId: 'ticket_1', reason: 'FORBIDDEN' }])
    expect(dispatchTicketUpdatedMock).not.toHaveBeenCalled()
  })
})
