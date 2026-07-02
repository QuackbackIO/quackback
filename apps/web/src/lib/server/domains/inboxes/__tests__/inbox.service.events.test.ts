/**
 * Phase 6: webhook dispatch from inbox CRUD.
 *
 * Verifies that `createInbox`, `updateInbox`, `archiveInbox`, and
 * `unarchiveInbox` fire the matching configuration-plane dispatchers, that
 * `*.updated` carries the changed field list, that no-op updates skip the
 * dispatch, and that a failing dispatcher is swallowed (warn-only) so the
 * inbox write itself stays the source of truth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const inboxFindFirstMock = vi.fn()
const insertReturningMock = vi.fn()
const insertInboxValuesMock = vi.fn()
const insertMembershipValuesMock = vi.fn()
const updateReturningMock = vi.fn()
const insertMock = vi.fn()
const transactionMock = vi.fn()

const dispatchInboxCreatedMock = vi.fn()
const dispatchInboxUpdatedMock = vi.fn()
const dispatchInboxArchivedMock = vi.fn()
const dispatchInboxUnarchivedMock = vi.fn()
// Phase-6 housekeeping guard: archiving an inbox must NOT cascade per-ticket
// dispatches. We register the ticket dispatchers here so we can assert they
// stay untouched.
const dispatchTicketUpdatedMock = vi.fn()
const dispatchTicketStatusChangedMock = vi.fn()
const buildEventActorMock = vi.fn((input: { principalId: string; userId?: string }) => ({
  type: 'user' as const,
  principalId: input.principalId,
  userId: input.userId,
  displayName: 'inbox-system',
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      inboxes: { findFirst: inboxFindFirstMock },
    },
    insert: insertMock,
    transaction: transactionMock,
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: updateReturningMock,
    })),
    select: vi.fn(),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  ilike: vi.fn(),
  or: vi.fn(),
  asc: vi.fn(),
  inboxes: { _name: 'inboxes', id: 'id', slug: 'slug', archivedAt: 'archivedAt' },
  inboxMemberships: { _name: 'inboxMemberships' },
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
  dispatchInboxCreated: (...a: unknown[]) => dispatchInboxCreatedMock(...a),
  dispatchInboxUpdated: (...a: unknown[]) => dispatchInboxUpdatedMock(...a),
  dispatchInboxArchived: (...a: unknown[]) => dispatchInboxArchivedMock(...a),
  dispatchInboxUnarchived: (...a: unknown[]) => dispatchInboxUnarchivedMock(...a),
  dispatchTicketUpdated: (...a: unknown[]) => dispatchTicketUpdatedMock(...a),
  dispatchTicketStatusChanged: (...a: unknown[]) => dispatchTicketStatusChangedMock(...a),
  buildEventActor: (...a: unknown[]) =>
    buildEventActorMock(...(a as [{ principalId: string; userId?: string }])),
}))

beforeEach(() => {
  vi.clearAllMocks()
  insertMock.mockImplementation((table) => {
    const valuesMock =
      table?._name === 'inboxMemberships' ? insertMembershipValuesMock : insertInboxValuesMock
    return {
      values: vi.fn((values) => {
        valuesMock(values)
        return { returning: insertReturningMock }
      }),
    }
  })
  transactionMock.mockImplementation((callback) => callback({ insert: insertMock }))
})

const ACTOR = { principalId: 'principal_a' as never, userId: 'user_a' as never }

const SAMPLE_INBOX = {
  id: 'inbox_1',
  name: 'Support',
  slug: 'support',
  description: null,
  primaryTeamId: null,
  defaultVisibilityScope: 'team',
  defaultPriority: 'normal',
  defaultStatusId: null,
  color: null,
  icon: null,
  archivedAt: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
}

describe('inbox.service events (Phase 6)', () => {
  it('dispatches inbox.created on create', async () => {
    inboxFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_INBOX])

    const { createInbox } = await import('../inbox.service')
    const result = await createInbox({ name: 'Support', slug: 'support' }, ACTOR)

    expect(result).toEqual(SAMPLE_INBOX)
    expect(insertMembershipValuesMock).toHaveBeenCalledTimes(1)
    expect(insertMembershipValuesMock).toHaveBeenCalledWith({
      inboxId: 'inbox_1',
      principalId: 'principal_a',
      role: 'owner',
    })
    expect(dispatchInboxCreatedMock).toHaveBeenCalledTimes(1)
    expect(dispatchInboxCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user', principalId: 'principal_a' }),
      SAMPLE_INBOX
    )
  })

  it('skips inbox.updated when patch is empty', async () => {
    inboxFindFirstMock.mockResolvedValue(SAMPLE_INBOX)

    const { updateInbox } = await import('../inbox.service')
    const result = await updateInbox('inbox_1' as never, {}, ACTOR)

    expect(result).toEqual(SAMPLE_INBOX)
    expect(dispatchInboxUpdatedMock).not.toHaveBeenCalled()
  })

  it('dispatches inbox.updated with changedFields', async () => {
    inboxFindFirstMock.mockResolvedValue(SAMPLE_INBOX)
    const updated = { ...SAMPLE_INBOX, name: 'Renamed' }
    updateReturningMock.mockResolvedValue([updated])

    const { updateInbox } = await import('../inbox.service')
    await updateInbox('inbox_1' as never, { name: 'Renamed' }, ACTOR)

    expect(dispatchInboxUpdatedMock).toHaveBeenCalledTimes(1)
    expect(dispatchInboxUpdatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user' }),
      updated,
      ['name']
    )
  })

  it('dispatches inbox.archived on archive', async () => {
    inboxFindFirstMock.mockResolvedValue(SAMPLE_INBOX)
    const archived = { ...SAMPLE_INBOX, archivedAt: new Date('2025-02-01') }
    updateReturningMock.mockResolvedValue([archived])

    const { archiveInbox } = await import('../inbox.service')
    await archiveInbox('inbox_1' as never, ACTOR)

    expect(dispatchInboxArchivedMock).toHaveBeenCalledTimes(1)
    expect(dispatchInboxArchivedMock).toHaveBeenCalledWith(expect.any(Object), archived)
  })

  // Phase-6 housekeeping: locks in the decision that archiveInbox fires only
  // `inbox.archived` and never cascades per-ticket events. Subscribers wanting
  // ticket-level awareness must subscribe to ticket.* events separately.
  it('archiveInbox does NOT fire any ticket.* events', async () => {
    inboxFindFirstMock.mockResolvedValue(SAMPLE_INBOX)
    const archived = { ...SAMPLE_INBOX, archivedAt: new Date('2025-02-01') }
    updateReturningMock.mockResolvedValue([archived])

    const { archiveInbox } = await import('../inbox.service')
    await archiveInbox('inbox_1' as never, ACTOR)

    expect(dispatchInboxArchivedMock).toHaveBeenCalledTimes(1)
    expect(dispatchTicketUpdatedMock).not.toHaveBeenCalled()
    expect(dispatchTicketStatusChangedMock).not.toHaveBeenCalled()
  })

  it('dispatches inbox.unarchived on unarchive', async () => {
    const archivedInbox = { ...SAMPLE_INBOX, archivedAt: new Date('2025-02-01') }
    inboxFindFirstMock.mockResolvedValue(archivedInbox)
    const restored = { ...SAMPLE_INBOX, archivedAt: null }
    updateReturningMock.mockResolvedValue([restored])

    const { unarchiveInbox } = await import('../inbox.service')
    await unarchiveInbox('inbox_1' as never, ACTOR)

    expect(dispatchInboxUnarchivedMock).toHaveBeenCalledTimes(1)
    expect(dispatchInboxUnarchivedMock).toHaveBeenCalledWith(expect.any(Object), restored)
  })

  it('uses service actor when principalId is null', async () => {
    inboxFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_INBOX])

    const { createInbox } = await import('../inbox.service')
    await createInbox({ name: 'Support', slug: 'support' }, { principalId: null })

    expect(insertMembershipValuesMock).not.toHaveBeenCalled()
    expect(dispatchInboxCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'service', displayName: 'inbox-system' }),
      SAMPLE_INBOX
    )
  })

  it('swallows dispatcher errors (write is source of truth)', async () => {
    inboxFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_INBOX])
    dispatchInboxCreatedMock.mockRejectedValueOnce(new Error('hook boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { createInbox } = await import('../inbox.service')
    const result = await createInbox({ name: 'Support', slug: 'support' }, ACTOR)

    expect(result).toEqual(SAMPLE_INBOX)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
