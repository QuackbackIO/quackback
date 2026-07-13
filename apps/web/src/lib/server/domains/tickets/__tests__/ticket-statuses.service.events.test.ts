/**
 * Phase 6: webhook dispatch from ticket-status CRUD.
 *
 * Verifies that `createTicketStatus`, `updateTicketStatus`, and
 * `archiveTicketStatus` fire the matching configuration-plane dispatchers,
 * that no-op updates skip dispatch, and that archive maps to
 * `ticket_status.updated` with `changedFields: ['deletedAt']` (per design —
 * there is no separate `ticket_status.archived` event).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirstMock = vi.fn()
const insertReturningMock = vi.fn()
const updateReturningMock = vi.fn()
const updateWhereMock = vi.fn().mockReturnThis()

const dispatchTicketStatusCreatedMock = vi.fn()
const dispatchTicketStatusUpdatedMock = vi.fn()
const buildEventActorMock = vi.fn((input: { principalId: string; userId?: string }) => ({
  type: 'user' as const,
  principalId: input.principalId,
  userId: input.userId,
  displayName: 'ticket-status-system',
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketStatuses: { findFirst: findFirstMock },
    },
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      returning: insertReturningMock,
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: updateWhereMock,
      returning: updateReturningMock,
    })),
    select: vi.fn(),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  asc: vi.fn(),
  ticketStatuses: {
    _name: 'ticket_statuses',
    id: 'id',
    slug: 'slug',
    isDefault: 'isDefault',
    deletedAt: 'deletedAt',
  },
  TICKET_STATUS_CATEGORIES: ['open', 'pending', 'on_hold', 'solved', 'closed'],
}))

vi.mock('@/lib/shared/errors', () => {
  class E extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  }
  return { ConflictError: E, NotFoundError: E, ValidationError: E }
})

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchTicketStatusCreated: (...a: unknown[]) => dispatchTicketStatusCreatedMock(...a),
  dispatchTicketStatusUpdated: (...a: unknown[]) => dispatchTicketStatusUpdatedMock(...a),
  buildEventActor: (...a: unknown[]) =>
    buildEventActorMock(...(a as [{ principalId: string; userId?: string }])),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const ACTOR = { principalId: 'principal_a' as never, userId: 'user_a' as never }

const SAMPLE_STATUS = {
  id: 'tstatus_1',
  name: 'Open',
  slug: 'open',
  color: '#6b7280',
  category: 'open',
  position: 0,
  isDefault: true,
  isSystem: false,
  deletedAt: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
}

describe('ticket-statuses.service events (Phase 6)', () => {
  it('dispatches ticket_status.created on create', async () => {
    findFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_STATUS])

    const { createTicketStatus } = await import('../ticket-statuses.service')
    await createTicketStatus({ name: 'Open', slug: 'open', category: 'open' }, ACTOR)

    expect(dispatchTicketStatusCreatedMock).toHaveBeenCalledTimes(1)
    expect(dispatchTicketStatusCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user', principalId: 'principal_a' }),
      SAMPLE_STATUS
    )
  })

  it('skips ticket_status.updated when patch is empty', async () => {
    findFirstMock.mockResolvedValue(SAMPLE_STATUS)

    const { updateTicketStatus } = await import('../ticket-statuses.service')
    const result = await updateTicketStatus('tstatus_1' as never, {}, ACTOR)

    expect(result).toEqual(SAMPLE_STATUS)
    expect(dispatchTicketStatusUpdatedMock).not.toHaveBeenCalled()
  })

  it('dispatches ticket_status.updated with changedFields', async () => {
    findFirstMock.mockResolvedValue(SAMPLE_STATUS)
    const updated = { ...SAMPLE_STATUS, name: 'Active', color: '#00ff00' }
    updateReturningMock.mockResolvedValue([updated])

    const { updateTicketStatus } = await import('../ticket-statuses.service')
    await updateTicketStatus('tstatus_1' as never, { name: 'Active', color: '#00ff00' }, ACTOR)

    expect(dispatchTicketStatusUpdatedMock).toHaveBeenCalledTimes(1)
    const [, , changed] = dispatchTicketStatusUpdatedMock.mock.calls[0] as [
      unknown,
      unknown,
      string[],
    ]
    expect(changed.sort()).toEqual(['color', 'name'])
  })

  it('archive dispatches ticket_status.updated with deletedAt only', async () => {
    findFirstMock.mockResolvedValue(SAMPLE_STATUS)
    const archived = { ...SAMPLE_STATUS, deletedAt: new Date('2025-02-01'), isDefault: false }
    updateReturningMock.mockResolvedValue([archived])

    const { archiveTicketStatus } = await import('../ticket-statuses.service')
    await archiveTicketStatus('tstatus_1' as never, ACTOR)

    expect(dispatchTicketStatusUpdatedMock).toHaveBeenCalledWith(expect.any(Object), archived, [
      'deletedAt',
    ])
    expect(dispatchTicketStatusCreatedMock).not.toHaveBeenCalled()
  })

  it('uses service actor when principalId is null', async () => {
    findFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_STATUS])

    const { createTicketStatus } = await import('../ticket-statuses.service')
    await createTicketStatus(
      { name: 'Open', slug: 'open', category: 'open' },
      { principalId: null }
    )

    expect(dispatchTicketStatusCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'service', displayName: 'ticket-status-system' }),
      SAMPLE_STATUS
    )
  })

  it('swallows dispatcher errors', async () => {
    findFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_STATUS])
    dispatchTicketStatusCreatedMock.mockRejectedValueOnce(new Error('hook boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { createTicketStatus } = await import('../ticket-statuses.service')
    const result = await createTicketStatus({ name: 'Open', slug: 'open', category: 'open' }, ACTOR)

    expect(result).toEqual(SAMPLE_STATUS)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
