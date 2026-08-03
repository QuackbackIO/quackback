/**
 * ticket.threads — verifies first-response timestamp behaviour and audience
 * filtering in `listThreads`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ticketFindFirstMock = vi.fn()
const sharesFindFirstMock = vi.fn()
const threadFindFirstMock = vi.fn()
const insertThreadsReturningMock = vi.fn()
const insertActivityReturningMock = vi.fn()
const updateChainSetMock = vi.fn()
const updateTicketChainWhereMock = vi.fn()
const updateReturningMock = vi.fn()
const selectFromMock = vi.fn()
const selectWhereMock = vi.fn()
const selectOrderByMock = vi.fn()
const notifyThreadAddedMock = vi.fn()
const onCustomerReplyMock = vi.fn()
const onPublicAgentReplyMock = vi.fn()
const dispatchTicketThreadAddedMock = vi.fn()
const dispatchTicketFirstResponseMock = vi.fn()
const dispatchTicketThreadUpdatedMock = vi.fn()
const dispatchTicketThreadDeletedMock = vi.fn()
const buildEventActorMock = vi.fn((input: { principalId: string; displayName?: string }) => ({
  type: 'user' as const,
  principalId: input.principalId,
  displayName: input.displayName ?? 'ticket-system',
}))

vi.mock('@/lib/server/db', () => {
  const insertChain = (which: 'threads' | 'activity') => ({
    values: vi.fn().mockReturnThis(),
    returning: which === 'threads' ? insertThreadsReturningMock : insertActivityReturningMock,
  })
  const updateChain = {
    set: (patch: unknown) => {
      updateChainSetMock(patch)
      return updateChain
    },
    where: (...args: unknown[]) => {
      updateTicketChainWhereMock(...args)
      return {
        returning: updateReturningMock,
      }
    },
  }
  return {
    db: {
      query: {
        tickets: { findFirst: ticketFindFirstMock },
        ticketShares: { findFirst: sharesFindFirstMock },
        ticketThreads: { findFirst: threadFindFirstMock },
      },
      insert: vi.fn((tbl: { _name: string }) => {
        if (tbl._name === 'ticket_activity') return insertChain('activity')
        return insertChain('threads')
      }),
      update: vi.fn(() => updateChain),
      select: vi.fn(() => ({
        from: (table: unknown) => {
          selectFromMock(table)
          return {
            where: (condition: unknown) => {
              selectWhereMock(condition)
              return { orderBy: (...args: unknown[]) => selectOrderByMock(...args) }
            },
          }
        },
      })),
    },
    eq: vi.fn((left: unknown, right: unknown) => ['eq', left, right]),
    and: vi.fn((...parts: unknown[]) => ['and', ...parts]),
    or: vi.fn((...parts: unknown[]) => ['or', ...parts]),
    isNull: vi.fn((value: unknown) => ['isNull', value]),
    asc: vi.fn((value: unknown) => ['asc', value]),
    inArray: vi.fn((left: unknown, right: unknown) => ['inArray', left, right]),
    tickets: {
      _name: 'tickets',
      id: 'tickets.id',
      deletedAt: 'tickets.deletedAt',
    },
    ticketThreads: {
      _name: 'ticket_threads',
      id: 'ticketThreads.id',
      ticketId: 'ticketThreads.ticketId',
      deletedAt: 'ticketThreads.deletedAt',
      createdAt: 'ticketThreads.createdAt',
    },
    ticketShares: {
      _name: 'ticket_shares',
      ticketId: 'ticketShares.ticketId',
      teamId: 'ticketShares.teamId',
      revokedAt: 'ticketShares.revokedAt',
    },
    TICKET_THREAD_AUDIENCES: ['public', 'internal', 'shared_team'] as const,
  }
})

vi.mock('@/lib/server/sanitize-tiptap', () => ({
  sanitizeTiptapContent: (c: unknown) => c,
}))

vi.mock('../../audit', () => ({
  recordEvent: vi.fn(),
}))

vi.mock('../ticket.service', () => ({
  writeActivity: vi.fn().mockResolvedValue({ id: 'ticket_act_x' }),
  bumpLastActivity: vi.fn(),
}))

vi.mock('../ticket.notifications', () => ({
  notifyThreadAdded: (...args: unknown[]) => notifyThreadAddedMock(...args),
}))

vi.mock('@/lib/server/domains/sla/sla.engine', () => ({
  onCustomerReply: (...args: unknown[]) => onCustomerReplyMock(...args),
  onPublicAgentReply: (...args: unknown[]) => onPublicAgentReplyMock(...args),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...args: unknown[]) =>
    buildEventActorMock(...(args as [{ principalId: string; displayName?: string }])),
  dispatchTicketThreadAdded: (...args: unknown[]) => dispatchTicketThreadAddedMock(...args),
  dispatchTicketFirstResponse: (...args: unknown[]) => dispatchTicketFirstResponseMock(...args),
  dispatchTicketThreadUpdated: (...args: unknown[]) => dispatchTicketThreadUpdatedMock(...args),
  dispatchTicketThreadDeleted: (...args: unknown[]) => dispatchTicketThreadDeletedMock(...args),
}))

vi.mock('@/lib/shared/errors', () => {
  class E extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  }
  return { ConflictError: E, NotFoundError: E, ValidationError: E, ForbiddenError: E }
})

beforeEach(() => {
  vi.clearAllMocks()
  ticketFindFirstMock.mockReset()
  sharesFindFirstMock.mockReset()
  threadFindFirstMock.mockReset()
  insertThreadsReturningMock.mockReset()
  insertActivityReturningMock.mockReset()
  insertActivityReturningMock.mockResolvedValue([{ id: 'act' }])
  updateReturningMock.mockReset()
  updateChainSetMock.mockReset()
  updateTicketChainWhereMock.mockReset()
  selectFromMock.mockReset()
  selectWhereMock.mockReset()
  selectOrderByMock.mockReset()
  selectOrderByMock.mockResolvedValue([])
  notifyThreadAddedMock.mockReset()
  notifyThreadAddedMock.mockResolvedValue(undefined)
  onCustomerReplyMock.mockReset()
  onCustomerReplyMock.mockResolvedValue(undefined)
  onPublicAgentReplyMock.mockReset()
  onPublicAgentReplyMock.mockResolvedValue(undefined)
  dispatchTicketThreadAddedMock.mockReset()
  dispatchTicketThreadAddedMock.mockResolvedValue(undefined)
  dispatchTicketFirstResponseMock.mockReset()
  dispatchTicketFirstResponseMock.mockResolvedValue(undefined)
  dispatchTicketThreadUpdatedMock.mockReset()
  dispatchTicketThreadUpdatedMock.mockResolvedValue(undefined)
  dispatchTicketThreadDeletedMock.mockReset()
  dispatchTicketThreadDeletedMock.mockResolvedValue(undefined)
  buildEventActorMock.mockClear()
})

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket_1',
    requesterPrincipalId: 'user_requester',
    firstResponseAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread_1',
    ticketId: 'ticket_1',
    principalId: 'user_agent',
    audience: 'public',
    bodyJson: null,
    bodyText: 'hello',
    sharedWithTeamId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    editedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

describe('addThread — firstResponseAt', () => {
  it('sets firstResponseAt when first PUBLIC thread is from a non-requester', async () => {
    ticketFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_1',
      requesterPrincipalId: 'user_requester',
      firstResponseAt: null,
      deletedAt: null,
    })
    insertThreadsReturningMock.mockResolvedValueOnce([{ id: 'thread_1', audience: 'public' }])
    const { addThread } = await import('../ticket.threads')
    await addThread({
      ticketId: 'ticket_1' as never,
      principalId: 'user_agent' as never,
      audience: 'public',
      bodyText: 'hello',
    })
    // The header-update call must include firstResponseAt
    expect(updateChainSetMock).toHaveBeenCalled()
    const patch = updateChainSetMock.mock.calls[0][0] as Record<string, unknown>
    expect(patch.firstResponseAt).toBeInstanceOf(Date)
  })

  it('does NOT set firstResponseAt when the author is the requester', async () => {
    ticketFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_1',
      requesterPrincipalId: 'user_requester',
      firstResponseAt: null,
      deletedAt: null,
    })
    insertThreadsReturningMock.mockResolvedValueOnce([{ id: 'thread_1', audience: 'public' }])
    const { addThread } = await import('../ticket.threads')
    await addThread({
      ticketId: 'ticket_1' as never,
      principalId: 'user_requester' as never,
      audience: 'public',
      bodyText: 'follow up',
    })
    const patch = updateChainSetMock.mock.calls[0][0] as Record<string, unknown>
    expect(patch.firstResponseAt).toBeUndefined()
  })

  it('does NOT set firstResponseAt for internal-only threads', async () => {
    ticketFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_1',
      requesterPrincipalId: 'user_requester',
      firstResponseAt: null,
      deletedAt: null,
    })
    insertThreadsReturningMock.mockResolvedValueOnce([{ id: 'thread_1', audience: 'internal' }])
    const { addThread } = await import('../ticket.threads')
    await addThread({
      ticketId: 'ticket_1' as never,
      principalId: 'user_agent' as never,
      audience: 'internal',
      bodyText: 'note to self',
    })
    const patch = updateChainSetMock.mock.calls[0][0] as Record<string, unknown>
    expect(patch.firstResponseAt).toBeUndefined()
  })

  it('refuses shared_team thread when no active share grant exists', async () => {
    ticketFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_1',
      requesterPrincipalId: 'user_requester',
      firstResponseAt: null,
      deletedAt: null,
    })
    sharesFindFirstMock.mockResolvedValueOnce(undefined)
    const { addThread } = await import('../ticket.threads')
    await expect(
      addThread({
        ticketId: 'ticket_1' as never,
        principalId: 'user_agent' as never,
        audience: 'shared_team',
        sharedWithTeamId: 'team_y' as never,
        bodyText: 'fyi',
      })
    ).rejects.toThrow(/share grant/i)
  })

  it('rejects empty bodies', async () => {
    ticketFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_1',
      requesterPrincipalId: null,
      firstResponseAt: null,
      deletedAt: null,
    })
    const { addThread } = await import('../ticket.threads')
    await expect(
      addThread({
        ticketId: 'ticket_1' as never,
        principalId: null,
        audience: 'public',
        bodyText: '   ',
      })
    ).rejects.toThrow(/empty/i)
  })

  it('validates audience/team combinations and missing tickets before writing', async () => {
    const { addThread } = await import('../ticket.threads')

    await expect(
      addThread({
        ticketId: 'ticket_1' as never,
        principalId: 'user_agent' as never,
        audience: 'invalid' as never,
        bodyText: 'hello',
      })
    ).rejects.toMatchObject({ code: 'TICKET_THREAD_AUDIENCE_INVALID' })

    await expect(
      addThread({
        ticketId: 'ticket_1' as never,
        principalId: 'user_agent' as never,
        audience: 'shared_team',
        bodyText: 'hello',
      })
    ).rejects.toMatchObject({ code: 'TICKET_THREAD_SHARED_TEAM_REQUIRED' })

    await expect(
      addThread({
        ticketId: 'ticket_1' as never,
        principalId: 'user_agent' as never,
        audience: 'public',
        sharedWithTeamId: 'team_1' as never,
        bodyText: 'hello',
      })
    ).rejects.toMatchObject({ code: 'TICKET_THREAD_SHARED_TEAM_NOT_ALLOWED' })

    ticketFindFirstMock.mockResolvedValueOnce(undefined)
    await expect(
      addThread({
        ticketId: 'ticket_1' as never,
        principalId: 'user_agent' as never,
        audience: 'public',
        bodyText: 'hello',
      })
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })

    ticketFindFirstMock.mockResolvedValueOnce(ticket())
    await expect(
      addThread({
        ticketId: 'ticket_1' as never,
        principalId: 'user_agent' as never,
        audience: 'public',
        bodyText: 'x'.repeat(100_001),
      })
    ).rejects.toMatchObject({ code: 'TICKET_THREAD_TOO_LONG' })
  })

  it('fires SLA, notification, and webhook side effects for public first responses', async () => {
    ticketFindFirstMock.mockResolvedValueOnce(ticket())
    const created = thread({ id: 'thread_long', bodyText: 'ignored' })
    insertThreadsReturningMock.mockResolvedValueOnce([created])
    const bodyText = 'x'.repeat(510)

    const { addThread } = await import('../ticket.threads')
    await expect(
      addThread({
        ticketId: 'ticket_1' as never,
        principalId: 'user_agent' as never,
        audience: 'public',
        bodyText,
        syncSourceIntegrationId: 'github_1',
      })
    ).resolves.toBe(created)

    expect(onPublicAgentReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ticket_1', firstResponseAt: expect.any(Date) }),
      'user_agent'
    )
    expect(onCustomerReplyMock).not.toHaveBeenCalled()
    expect(notifyThreadAddedMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ticket_1' }),
      'thread_long',
      'public',
      null,
      { actorPrincipalId: 'user_agent' }
    )
    expect(dispatchTicketFirstResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'user_agent' }),
      expect.objectContaining({ id: 'ticket_1' }),
      'thread_long',
      expect.any(String),
      { syncSourceIntegrationId: 'github_1' }
    )
    expect(dispatchTicketThreadAddedMock).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'user_agent' }),
      expect.objectContaining({ id: 'ticket_1' }),
      'thread_long',
      'public',
      null,
      expect.objectContaining({
        bodyText,
        bodyTextPreview: 'x'.repeat(500),
        bodyTextTruncated: true,
        isFromRequester: false,
      }),
      { syncSourceIntegrationId: 'github_1' }
    )
  })

  it('calls the customer SLA hook for public requester replies without first-response dispatch', async () => {
    ticketFindFirstMock.mockResolvedValueOnce(ticket())
    const created = thread({ principalId: 'user_requester' })
    insertThreadsReturningMock.mockResolvedValueOnce([created])

    const { addThread } = await import('../ticket.threads')
    await addThread({
      ticketId: 'ticket_1' as never,
      principalId: 'user_requester' as never,
      audience: 'public',
      bodyText: 'requester reply',
    })

    expect(onCustomerReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ticket_1' }),
      'user_requester'
    )
    expect(onPublicAgentReplyMock).not.toHaveBeenCalled()
    expect(dispatchTicketFirstResponseMock).not.toHaveBeenCalled()
  })
})

describe('editThread', () => {
  it('rejects missing, deleted, and non-owned threads', async () => {
    const { editThread } = await import('../ticket.threads')

    threadFindFirstMock.mockResolvedValueOnce(undefined)
    await expect(
      editThread({ threadId: 'thread_missing' as never, actorPrincipalId: 'user_agent' as never })
    ).rejects.toMatchObject({ code: 'TICKET_THREAD_NOT_FOUND' })

    threadFindFirstMock.mockResolvedValueOnce(thread({ deletedAt: new Date() }))
    await expect(
      editThread({ threadId: 'thread_deleted' as never, actorPrincipalId: 'user_agent' as never })
    ).rejects.toMatchObject({ code: 'TICKET_THREAD_NOT_FOUND' })

    threadFindFirstMock.mockResolvedValueOnce(thread({ principalId: 'user_other' }))
    await expect(
      editThread({ threadId: 'thread_1' as never, actorPrincipalId: 'user_agent' as never })
    ).rejects.toMatchObject({ code: 'TICKET_THREAD_NOT_OWNER' })
  })

  it('updates editable thread text and dispatches an update event when the ticket still exists', async () => {
    const existing = thread()
    const updated = thread({
      bodyText: 'edited text',
      editedAt: new Date('2026-01-01T01:00:00.000Z'),
    })
    threadFindFirstMock.mockResolvedValueOnce(existing)
    updateReturningMock.mockResolvedValueOnce([updated])
    ticketFindFirstMock.mockResolvedValueOnce(ticket())

    const { editThread } = await import('../ticket.threads')
    await expect(
      editThread({
        threadId: 'thread_1' as never,
        actorPrincipalId: 'user_agent' as never,
        bodyText: ' edited text ',
        syncSourceIntegrationId: 'github_1',
      })
    ).resolves.toBe(updated)

    expect(updateChainSetMock).toHaveBeenCalledWith({
      bodyJson: null,
      bodyText: 'edited text',
      editedAt: expect.any(Date),
      editedByPrincipalId: 'user_agent',
    })
    expect(dispatchTicketThreadUpdatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'user_agent' }),
      expect.objectContaining({ id: 'ticket_1' }),
      'thread_1',
      'public',
      null,
      expect.objectContaining({
        bodyText: 'edited text',
        bodyTextPreview: 'edited text',
        bodyTextTruncated: false,
        isFromRequester: false,
      }),
      { syncSourceIntegrationId: 'github_1' }
    )
  })
})

describe('softDeleteThread', () => {
  it('rejects missing and already-deleted threads', async () => {
    const { softDeleteThread } = await import('../ticket.threads')

    threadFindFirstMock.mockResolvedValueOnce(undefined)
    await expect(
      softDeleteThread('thread_missing' as never, 'user_agent' as never)
    ).rejects.toMatchObject({ code: 'TICKET_THREAD_NOT_FOUND' })

    threadFindFirstMock.mockResolvedValueOnce(thread({ deletedAt: new Date() }))
    await expect(
      softDeleteThread('thread_deleted' as never, 'user_agent' as never)
    ).rejects.toMatchObject({ code: 'TICKET_THREAD_ALREADY_DELETED' })
  })

  it('soft-deletes a thread and dispatches a delete event with a service actor fallback', async () => {
    const existing = thread({ principalId: null, bodyText: 'deleted body' })
    const deleted = thread({ ...existing, deletedAt: new Date('2026-01-01T02:00:00.000Z') })
    threadFindFirstMock.mockResolvedValueOnce(existing)
    updateReturningMock.mockResolvedValueOnce([deleted])
    ticketFindFirstMock.mockResolvedValueOnce(ticket({ requesterPrincipalId: null }))

    const { softDeleteThread } = await import('../ticket.threads')
    await expect(softDeleteThread('thread_1' as never, null, 'github_1')).resolves.toBe(deleted)

    expect(updateChainSetMock).toHaveBeenCalledWith({ deletedAt: expect.any(Date) })
    expect(dispatchTicketThreadDeletedMock).toHaveBeenCalledWith(
      { type: 'service', displayName: 'ticket-system' },
      expect.objectContaining({ id: 'ticket_1' }),
      'thread_1',
      'public',
      null,
      null,
      expect.objectContaining({
        bodyText: 'deleted body',
        authorPrincipalId: null,
        isFromRequester: false,
      }),
      { syncSourceIntegrationId: 'github_1' }
    )
  })
})

describe('thread queries', () => {
  it('filters thread audiences for agents, requesters, shared teams, and deleted rows', async () => {
    const rows = [
      thread({ id: 'public_1', audience: 'public' }),
      thread({ id: 'internal_1', audience: 'internal' }),
      thread({ id: 'shared_visible', audience: 'shared_team', sharedWithTeamId: 'team_visible' }),
      thread({ id: 'shared_hidden', audience: 'shared_team', sharedWithTeamId: 'team_hidden' }),
      thread({ id: 'shared_missing', audience: 'shared_team', sharedWithTeamId: null }),
      thread({ id: 'unknown', audience: 'unknown' }),
    ]
    selectOrderByMock.mockResolvedValue(rows)

    const { listThreads } = await import('../ticket.threads')
    await expect(
      listThreads('ticket_1' as never, {
        viewerTeamIds: ['team_visible' as never],
        canSeeInternal: true,
      })
    ).resolves.toEqual([rows[0], rows[1], rows[2]])
    expect(selectWhereMock).toHaveBeenCalledWith(
      expect.arrayContaining(['and', ['eq', 'ticketThreads.ticketId', 'ticket_1']])
    )

    await expect(
      listThreads('ticket_1' as never, {
        viewerTeamIds: ['team_visible' as never],
        canSeeInternal: true,
        isRequester: true,
        includeDeleted: true,
      })
    ).resolves.toEqual([rows[0]])
  })

  it('gets threads, loads threads by ticket ids, and exposes public-only portal fetches', async () => {
    const row = thread()
    const { getThread, loadThreadsByTicketIds, listPublicThreadsForTicket } =
      await import('../ticket.threads')

    threadFindFirstMock.mockResolvedValueOnce(row).mockResolvedValueOnce(undefined)
    await expect(getThread('thread_1' as never)).resolves.toBe(row)
    await expect(getThread('missing' as never)).resolves.toBeNull()

    await expect(loadThreadsByTicketIds([])).resolves.toEqual([])

    selectOrderByMock.mockResolvedValueOnce([row])
    await expect(loadThreadsByTicketIds(['ticket_1' as never])).resolves.toEqual([row])
    expect(selectWhereMock).toHaveBeenCalledWith(
      expect.arrayContaining(['and', ['inArray', 'ticketThreads.ticketId', ['ticket_1']]])
    )

    selectOrderByMock.mockResolvedValueOnce([row, thread({ audience: 'internal' })])
    await expect(listPublicThreadsForTicket('ticket_1' as never)).resolves.toEqual([row])
  })
})
