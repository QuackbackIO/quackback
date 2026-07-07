/**
 * ticket.subscriptions — UPSERT semantics + mute window filtering.
 *
 * The schema-level concerns (FK cascade, unique constraint) live in the
 * integration suite; here we exercise the service-layer policy decisions:
 *   - auto sources never overwrite an existing manual row
 *   - manual writes refuse to mutate an auto row unless `force: true`
 *   - getSubscribers honours the mute window
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertReturningMock = vi.fn()
const insertOnConflictDoNothingMock = vi.fn()
const insertOnConflictDoUpdateMock = vi.fn()
const updateReturningMock = vi.fn()
const deleteReturningMock = vi.fn()
const selectFromMock = vi.fn()
const selectAwaitMock = vi.fn()

const insertChain: Record<string, unknown> = {}
insertChain.values = vi.fn().mockReturnThis()
insertChain.onConflictDoNothing = vi.fn(() => ({
  returning: insertOnConflictDoNothingMock,
}))
insertChain.onConflictDoUpdate = vi.fn(() => ({
  returning: insertOnConflictDoUpdateMock,
}))
insertChain.returning = insertReturningMock

const updateChain = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: updateReturningMock,
}

const deleteChain = {
  where: vi.fn().mockReturnThis(),
  returning: deleteReturningMock,
}

const selectChain = {
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  then: vi.fn((resolve, reject) => Promise.resolve(selectAwaitMock()).then(resolve, reject)),
}

vi.mock('@/lib/server/db', () => {
  return {
    db: {
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
      select: vi.fn(() => {
        selectFromMock()
        return selectChain
      }),
    },
    eq: vi.fn((a, b) => ({ _eq: [a, b] })),
    and: vi.fn((...args) => ({ _and: args })),
    or: vi.fn((...args) => ({ _or: args })),
    isNull: vi.fn((c) => ({ _isNull: c })),
    inArray: vi.fn(),
    gt: vi.fn(),
    lt: vi.fn((a, b) => ({ _lt: [a, b] })),
    desc: vi.fn(),
    sql: Object.assign(vi.fn(), { raw: vi.fn() }),
    ticketSubscriptions: {
      id: 'col.id',
      ticketId: 'col.ticketId',
      principalId: 'col.principalId',
      notifyThreads: 'col.notifyThreads',
      notifyProperties: 'col.notifyProperties',
      notifyStatus: 'col.notifyStatus',
      notifyAssignment: 'col.notifyAssignment',
      notifyParticipants: 'col.notifyParticipants',
      notifyShares: 'col.notifyShares',
      notifySla: 'col.notifySla',
      mutedUntil: 'col.mutedUntil',
      createdAt: 'col.createdAt',
    },
    tickets: {
      id: 'tickets.id',
      subject: 'tickets.subject',
      statusId: 'tickets.statusId',
      priority: 'tickets.priority',
      channel: 'tickets.channel',
      updatedAt: 'tickets.updatedAt',
    },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  insertReturningMock.mockReset()
  insertOnConflictDoNothingMock.mockReset()
  insertOnConflictDoUpdateMock.mockReset()
  updateReturningMock.mockReset()
  deleteReturningMock.mockReset()
  selectAwaitMock.mockReset()
  selectChain.limit.mockResolvedValue([])
  selectAwaitMock.mockReturnValue([])
})

describe('subscribeToTicket', () => {
  it('auto source returns the inserted row when there is no conflict', async () => {
    const inserted = { id: 'tkt_sub_new', source: 'auto_assigned', notifyThreads: true }
    insertOnConflictDoNothingMock.mockResolvedValue([inserted])

    const { subscribeToTicket } = await import('../ticket.subscriptions')
    const row = await subscribeToTicket({
      ticketId: 't1' as never,
      principalId: 'p1' as never,
      source: 'auto_assigned',
    })

    expect(row).toBe(inserted)
    expect(selectChain.limit).not.toHaveBeenCalled()
  })

  it('auto source uses onConflictDoNothing and falls back to existing row', async () => {
    insertOnConflictDoNothingMock.mockResolvedValue([]) // conflict path
    const existing = {
      id: 'tkt_sub_1',
      ticketId: 't1',
      principalId: 'p1',
      source: 'manual',
      notifyThreads: true,
    }
    selectChain.limit.mockResolvedValueOnce([existing])

    const { subscribeToTicket } = await import('../ticket.subscriptions')
    const row = await subscribeToTicket({
      ticketId: 't1' as never,
      principalId: 'p1' as never,
      source: 'auto_assigned',
    })
    expect(row).toBe(existing)
    expect(insertChain.onConflictDoNothing).toHaveBeenCalled()
    expect(insertChain.onConflictDoUpdate).not.toHaveBeenCalled()
  })

  it('throws if an auto-source conflict cannot load the existing row', async () => {
    insertOnConflictDoNothingMock.mockResolvedValue([])
    selectChain.limit.mockResolvedValueOnce([])

    const { subscribeToTicket } = await import('../ticket.subscriptions')
    await expect(
      subscribeToTicket({
        ticketId: 't1' as never,
        principalId: 'p1' as never,
        source: 'auto_assigned',
      })
    ).rejects.toThrow('row vanished')
  })

  it('manual source uses onConflictDoUpdate (overwrites prefs + clears mute)', async () => {
    insertOnConflictDoUpdateMock.mockResolvedValue([
      { id: 'tkt_sub_2', source: 'manual', notifyThreads: false, mutedUntil: null },
    ])
    const { subscribeToTicket } = await import('../ticket.subscriptions')
    const row = await subscribeToTicket({
      ticketId: 't1' as never,
      principalId: 'p1' as never,
      source: 'manual',
      prefs: { notifyThreads: false },
    })
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalled()
    expect(row.source).toBe('manual')
    expect(row.notifyThreads).toBe(false)
  })
})

describe('updateSubscriptionPrefs', () => {
  it('returns null when there is no existing row to patch', async () => {
    selectChain.limit.mockResolvedValueOnce([])

    const { updateSubscriptionPrefs } = await import('../ticket.subscriptions')
    const row = await updateSubscriptionPrefs({
      ticketId: 't1' as never,
      principalId: 'p1' as never,
      patch: { notifyThreads: false },
    })

    expect(row).toBeNull()
    expect(updateChain.set).not.toHaveBeenCalled()
  })

  it('refuses to mutate an auto-sourced row without force:true', async () => {
    selectChain.limit.mockResolvedValueOnce([
      { id: 'tkt_sub_1', source: 'auto_assigned', notifyThreads: true },
    ])
    const { updateSubscriptionPrefs } = await import('../ticket.subscriptions')
    const row = await updateSubscriptionPrefs({
      ticketId: 't1' as never,
      principalId: 'p1' as never,
      patch: { notifyThreads: false },
    })
    expect(row?.source).toBe('auto_assigned')
    expect(updateChain.set).not.toHaveBeenCalled()
  })

  it('upgrades auto row to manual when force:true', async () => {
    selectChain.limit.mockResolvedValueOnce([
      { id: 'tkt_sub_1', source: 'auto_assigned', notifyThreads: true },
    ])
    updateReturningMock.mockResolvedValueOnce([
      { id: 'tkt_sub_1', source: 'manual', notifyThreads: false },
    ])
    const { updateSubscriptionPrefs } = await import('../ticket.subscriptions')
    const row = await updateSubscriptionPrefs({
      ticketId: 't1' as never,
      principalId: 'p1' as never,
      patch: { notifyThreads: false },
      force: true,
    })
    expect(updateChain.set).toHaveBeenCalled()
    expect(row?.source).toBe('manual')
  })

  it('patches all manual preference flags without changing source', async () => {
    selectChain.limit.mockResolvedValueOnce([{ id: 'tkt_sub_1', source: 'manual' }])
    updateReturningMock.mockResolvedValueOnce([{ id: 'tkt_sub_1', source: 'manual' }])

    const { updateSubscriptionPrefs } = await import('../ticket.subscriptions')
    await updateSubscriptionPrefs({
      ticketId: 't1' as never,
      principalId: 'p1' as never,
      patch: {
        notifyThreads: false,
        notifyProperties: false,
        notifyStatus: false,
        notifyAssignment: false,
        notifyParticipants: true,
        notifyShares: true,
        notifySla: false,
      },
    })

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyThreads: false,
        notifyProperties: false,
        notifyStatus: false,
        notifyAssignment: false,
        notifyParticipants: true,
        notifyShares: true,
        notifySla: false,
      })
    )
    expect(updateChain.set).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }))
  })
})

describe('subscription deletion and mute state', () => {
  it('returns whether unsubscribe deleted a row', async () => {
    const { unsubscribeFromTicket } = await import('../ticket.subscriptions')

    deleteReturningMock.mockResolvedValueOnce([{ id: 'tkt_sub_1' }])
    await expect(unsubscribeFromTicket('t1' as never, 'p1' as never)).resolves.toBe(true)

    deleteReturningMock.mockResolvedValueOnce([])
    await expect(unsubscribeFromTicket('t1' as never, 'p1' as never)).resolves.toBe(false)
  })

  it('sets and clears mute windows', async () => {
    const until = new Date('2026-01-01T00:00:00.000Z')
    const { muteTicket, unmuteTicket } = await import('../ticket.subscriptions')

    updateReturningMock.mockResolvedValueOnce([{ id: 'tkt_sub_1', mutedUntil: until }])
    await expect(muteTicket('t1' as never, 'p1' as never, until)).resolves.toMatchObject({
      mutedUntil: until,
    })
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ mutedUntil: until }))

    updateReturningMock.mockResolvedValueOnce([])
    await expect(unmuteTicket('t1' as never, 'p1' as never)).resolves.toBeNull()
    expect(updateChain.set).toHaveBeenLastCalledWith(expect.objectContaining({ mutedUntil: null }))
  })
})

describe('subscription readers', () => {
  it('returns subscribers whose mute window does not cover now', async () => {
    selectAwaitMock.mockReturnValueOnce([{ principalId: 'p1' }, { principalId: 'p2' }])

    const { getSubscribers } = await import('../ticket.subscriptions')
    await expect(getSubscribers('t1' as never, 'thread')).resolves.toEqual(['p1', 'p2'])

    expect(selectChain.where).toHaveBeenCalled()
  })

  it('lists subscriptions for a principal with cursor pagination', async () => {
    const rows = [{ id: 'tkt_sub_1', principalId: 'p1' }]
    selectChain.limit.mockResolvedValueOnce(rows)

    const { listSubscriptionsForPrincipal } = await import('../ticket.subscriptions')
    await expect(
      listSubscriptionsForPrincipal('p1' as never, {
        limit: 10,
        cursor: { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'tkt_sub_0' as never },
      })
    ).resolves.toBe(rows)

    expect(selectChain.orderBy).toHaveBeenCalled()
    expect(selectChain.limit).toHaveBeenCalledWith(10)
  })

  it('lists subscribers for a ticket ordered by creation time', async () => {
    const rows = [{ id: 'tkt_sub_1', ticketId: 't1' }]
    selectAwaitMock.mockReturnValueOnce(rows)

    const { listSubscribersForTicket } = await import('../ticket.subscriptions')
    await expect(listSubscribersForTicket('t1' as never)).resolves.toBe(rows)

    expect(selectChain.orderBy).toHaveBeenCalled()
  })

  it('lists subscriptions with ticket snapshots and maps the joined rows', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z')
    selectChain.limit.mockResolvedValueOnce([
      {
        sub: { id: 'tkt_sub_1', principalId: 'p1' },
        ticket: {
          id: 'ticket_1',
          subject: 'Need help',
          statusId: null,
          priority: 'normal',
          channel: 'portal',
          updatedAt,
        },
      },
    ])

    const { listSubscriptionsForPrincipalWithTickets } = await import('../ticket.subscriptions')
    await expect(
      listSubscriptionsForPrincipalWithTickets('p1' as never, { limit: 1 })
    ).resolves.toEqual([
      {
        id: 'tkt_sub_1',
        principalId: 'p1',
        ticket: {
          id: 'ticket_1',
          subject: 'Need help',
          statusId: null,
          priority: 'normal',
          channel: 'portal',
          updatedAt,
        },
      },
    ])
    expect(selectChain.innerJoin).toHaveBeenCalled()
  })
})

describe('safeSubscribe', () => {
  it('swallows subscription setup failures and logs a warning', async () => {
    insertOnConflictDoNothingMock.mockResolvedValue([])
    selectChain.limit.mockResolvedValueOnce([])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const { safeSubscribe } = await import('../ticket.subscriptions')
      await expect(
        safeSubscribe({
          ticketId: 't1' as never,
          principalId: 'p1' as never,
          source: 'auto_assigned',
        })
      ).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(
        '[tickets.subscriptions] safeSubscribe failed',
        expect.any(Error)
      )
    } finally {
      warn.mockRestore()
    }
  })
})
