import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, TicketId, TicketStatusId, UserId } from '@quackback/ids'
import { ForbiddenError } from '@/lib/shared/errors'

type HandlerArgs = { data: Record<string, unknown> }
type AnyHandler = (args: HandlerArgs) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockListTicketsForPortalUser: vi.fn(),
  mockGetTicketForPortalUser: vi.fn(),
  mockAddPortalReply: vi.fn(),
  mockUpdatePortalTicketDescription: vi.fn(),
  mockClosePortalTicket: vi.fn(),
  mockReopenPortalTicket: vi.fn(),
  mockBuildPortalIdentity: vi.fn(),
  mockResolveViewerRelationship: vi.fn(),
  mockListPublicThreadsForTicket: vi.fn(),
  mockCreateTicket: vi.fn(),
  mockGetMemberByUser: vi.fn(),
  mockTicketStatusesFindMany: vi.fn(),
  mockTicketStatusesFindFirst: vi.fn(),
  mockPrincipalFindFirst: vi.fn(),
  mockDbSelect: vi.fn(),
  mockEq: vi.fn(),
  mockInArray: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/domains/tickets/ticket.portal-query', () => ({
  listTicketsForPortalUser: hoisted.mockListTicketsForPortalUser,
  getTicketForPortalUser: hoisted.mockGetTicketForPortalUser,
  addPortalReply: hoisted.mockAddPortalReply,
  updatePortalTicketDescription: hoisted.mockUpdatePortalTicketDescription,
  closePortalTicket: hoisted.mockClosePortalTicket,
  reopenPortalTicket: hoisted.mockReopenPortalTicket,
  buildPortalIdentity: hoisted.mockBuildPortalIdentity,
  resolveViewerRelationship: hoisted.mockResolveViewerRelationship,
}))

vi.mock('@/lib/server/domains/tickets/ticket.threads', () => ({
  listPublicThreadsForTicket: hoisted.mockListPublicThreadsForTicket,
}))

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  createTicket: hoisted.mockCreateTicket,
}))

vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  getMemberByUser: hoisted.mockGetMemberByUser,
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketStatuses: {
        findMany: (...args: unknown[]) => hoisted.mockTicketStatusesFindMany(...args),
        findFirst: (...args: unknown[]) => hoisted.mockTicketStatusesFindFirst(...args),
      },
      principal: {
        findFirst: (...args: unknown[]) => hoisted.mockPrincipalFindFirst(...args),
      },
    },
    select: (...args: unknown[]) => hoisted.mockDbSelect(...args),
  },
  eq: (...args: unknown[]) => hoisted.mockEq(...args),
  inArray: (...args: unknown[]) => hoisted.mockInArray(...args),
  principal: {
    id: 'principal.id',
    type: 'principal.type',
    userId: 'principal.userId',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
  },
  ticketStatuses: {
    id: 'ticketStatuses.id',
  },
}))

const USER = 'user_portal' as UserId
const PRINCIPAL = 'principal_portal' as PrincipalId
const STAFF = 'principal_staff' as PrincipalId
const TICKET = 'ticket_portal' as TicketId
const STATUS_OPEN = 'status_open' as TicketStatusId
const STATUS_SOLVED = 'status_solved' as TicketStatusId
const CREATED = new Date('2026-04-01T10:00:00.000Z')
const UPDATED = new Date('2026-04-02T10:00:00.000Z')

await import('../portal-tickets')

const [
  listMyTicketsFn,
  getMyTicketFn,
  replyToMyTicketFn,
  updateMyTicketDescriptionFn,
  closeMyTicketFn,
  reopenMyTicketFn,
  createMyTicketFn,
  createTicketInitialThreadFn,
] = handlersByIndex

if (!createTicketInitialThreadFn) {
  throw new Error(`portal-ticket handlers were not registered; found ${handlersByIndex.length}`)
}

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    subject: 'Portal ticket',
    descriptionJson: null,
    descriptionText: 'Details',
    statusId: STATUS_OPEN,
    requesterPrincipalId: PRINCIPAL,
    createdAt: CREATED,
    lastActivityAt: UPDATED,
    updatedAt: UPDATED,
    ...overrides,
  }
}

function statusRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STATUS_OPEN,
    category: 'open',
    name: 'Open',
    color: '#16a34a',
    ...overrides,
  }
}

function principalSelectChain(rows: readonly Record<string, unknown>[]) {
  const chain = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn().mockResolvedValue(rows),
  }
  chain.from.mockReturnValue(chain)
  chain.leftJoin.mockReturnValue(chain)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: USER, email: 'portal@example.com' },
    principal: { id: PRINCIPAL },
  })
  hoisted.mockTicketStatusesFindMany.mockResolvedValue([statusRow()])
  hoisted.mockTicketStatusesFindFirst.mockResolvedValue(statusRow())
  hoisted.mockPrincipalFindFirst.mockResolvedValue({ id: PRINCIPAL })
  hoisted.mockGetTicketForPortalUser.mockResolvedValue(ticketRow())
  hoisted.mockListPublicThreadsForTicket.mockResolvedValue([])
  hoisted.mockBuildPortalIdentity.mockResolvedValue({ principalId: PRINCIPAL, contactIds: [] })
  hoisted.mockResolveViewerRelationship.mockResolvedValue('requester')
  hoisted.mockGetMemberByUser.mockResolvedValue({ id: PRINCIPAL })
})

describe('portal ticket list and detail server functions', () => {
  it('returns an empty list without status lookup when the portal query has no rows', async () => {
    hoisted.mockListTicketsForPortalUser.mockResolvedValue({ rows: [], total: 0 })

    const result = await listMyTicketsFn({
      data: { statusCategory: 'open', limit: 10, offset: 0 },
    })

    expect(result).toEqual({ rows: [], total: 0 })
    expect(hoisted.mockListTicketsForPortalUser).toHaveBeenCalledWith({
      userId: USER,
      statusCategory: 'open',
      limit: 10,
      offset: 0,
    })
    expect(hoisted.mockTicketStatusesFindMany).not.toHaveBeenCalled()
  })

  it('serializes list rows with status metadata and date strings', async () => {
    hoisted.mockListTicketsForPortalUser.mockResolvedValue({
      rows: [
        ticketRow({ statusId: STATUS_OPEN }),
        ticketRow({ id: 'ticket_unknown', statusId: 'status_missing' }),
      ],
      total: 2,
    })
    hoisted.mockTicketStatusesFindMany.mockResolvedValue([statusRow()])

    const result = await listMyTicketsFn({ data: { limit: 25 } })

    expect(result).toEqual({
      rows: [
        {
          id: TICKET,
          subject: 'Portal ticket',
          statusId: STATUS_OPEN,
          statusCategory: 'open',
          statusName: 'Open',
          statusColor: '#16a34a',
          lastActivityAt: UPDATED.toISOString(),
          createdAt: CREATED.toISOString(),
        },
        {
          id: 'ticket_unknown',
          subject: 'Portal ticket',
          statusId: 'status_missing',
          statusCategory: 'open',
          statusName: 'Unknown',
          statusColor: null,
          lastActivityAt: UPDATED.toISOString(),
          createdAt: CREATED.toISOString(),
        },
      ],
      total: 2,
    })
  })

  it('serializes ticket details, public threads, viewer identity, and principal names', async () => {
    hoisted.mockListPublicThreadsForTicket.mockResolvedValue([
      {
        id: 'thread_customer',
        principalId: PRINCIPAL,
        audience: 'public',
        bodyJson: { type: 'doc' },
        bodyText: 'Customer reply',
        createdAt: CREATED,
        editedAt: null,
      },
      {
        id: 'thread_staff',
        principalId: STAFF,
        audience: 'public',
        bodyJson: null,
        bodyText: 'Staff reply',
        createdAt: UPDATED,
        editedAt: UPDATED,
      },
    ])
    hoisted.mockDbSelect.mockReturnValueOnce(
      principalSelectChain([
        { id: PRINCIPAL, userName: 'Customer' },
        { id: STAFF, userName: null },
      ])
    )

    const result = await getMyTicketFn({ data: { ticketId: TICKET } })

    expect(hoisted.mockGetTicketForPortalUser).toHaveBeenCalledWith({
      userId: USER,
      ticketId: TICKET,
    })
    expect(hoisted.mockResolveViewerRelationship).toHaveBeenCalledWith(ticketRow(), {
      principalId: PRINCIPAL,
      contactIds: [],
    })
    expect(result).toMatchObject({
      ticket: {
        id: TICKET,
        statusName: 'Open',
        createdAt: CREATED.toISOString(),
        updatedAt: UPDATED.toISOString(),
      },
      principalNames: {
        [PRINCIPAL]: 'Customer',
        [STAFF]: 'User',
      },
      viewerPrincipalId: PRINCIPAL,
      viewerRelationship: 'requester',
    })
    expect((result as { threads: Array<{ id: string; editedAt: string | null }> }).threads).toEqual(
      [
        expect.objectContaining({ id: 'thread_customer', editedAt: null }),
        expect.objectContaining({ id: 'thread_staff', editedAt: UPDATED.toISOString() }),
      ]
    )
  })
})

describe('portal ticket mutation server functions', () => {
  it('creates portal replies with the authenticated user id and serializes the thread', async () => {
    hoisted.mockAddPortalReply.mockResolvedValue({
      id: 'thread_reply',
      ticketId: TICKET,
      audience: 'public',
      createdAt: CREATED,
    })

    const result = await replyToMyTicketFn({
      data: {
        ticketId: TICKET,
        bodyText: 'Reply',
      },
    })

    expect(hoisted.mockAddPortalReply).toHaveBeenCalledWith({
      userId: USER,
      ticketId: TICKET,
      bodyJson: null,
      bodyText: 'Reply',
    })
    expect(result).toEqual({
      id: 'thread_reply',
      ticketId: TICKET,
      audience: 'public',
      createdAt: CREATED.toISOString(),
    })
  })

  it('updates portal ticket descriptions with a conflict timestamp', async () => {
    hoisted.mockUpdatePortalTicketDescription.mockResolvedValue({
      id: TICKET,
      updatedAt: UPDATED,
    })

    const result = await updateMyTicketDescriptionFn({
      data: {
        ticketId: TICKET,
        expectedUpdatedAt: '2026-04-01T10:00:00.000Z',
        descriptionText: 'Updated details',
      },
    })

    expect(hoisted.mockUpdatePortalTicketDescription).toHaveBeenCalledWith({
      userId: USER,
      ticketId: TICKET,
      expectedUpdatedAt: CREATED,
      descriptionJson: null,
      descriptionText: 'Updated details',
    })
    expect(result).toEqual({ id: TICKET, updatedAt: UPDATED.toISOString() })
  })

  it('closes and reopens tickets with status fallbacks when status lookup misses', async () => {
    hoisted.mockTicketStatusesFindFirst.mockResolvedValue(undefined)
    hoisted.mockClosePortalTicket.mockResolvedValue({
      id: TICKET,
      statusId: STATUS_SOLVED,
      updatedAt: UPDATED,
    })
    hoisted.mockReopenPortalTicket.mockResolvedValue({
      id: TICKET,
      statusId: null,
      updatedAt: UPDATED,
    })

    const closed = await closeMyTicketFn({ data: { ticketId: TICKET } })
    const reopened = await reopenMyTicketFn({ data: { ticketId: TICKET } })

    expect(hoisted.mockClosePortalTicket).toHaveBeenCalledWith({
      userId: USER,
      ticketId: TICKET,
    })
    expect(hoisted.mockReopenPortalTicket).toHaveBeenCalledWith({
      userId: USER,
      ticketId: TICKET,
    })
    expect(closed).toEqual({
      id: TICKET,
      statusCategory: 'solved',
      statusName: 'Solved',
      updatedAt: UPDATED.toISOString(),
    })
    expect(reopened).toEqual({
      id: TICKET,
      statusCategory: 'open',
      statusName: 'Open',
      updatedAt: UPDATED.toISOString(),
    })
  })
})

describe('portal ticket creation server functions', () => {
  it('rejects portal ticket creation when the authenticated user has no principal', async () => {
    hoisted.mockGetMemberByUser.mockResolvedValue(null)

    await expect(
      createMyTicketFn({ data: { subject: 'Need help', descriptionText: 'Details' } })
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(hoisted.mockCreateTicket).not.toHaveBeenCalled()
  })

  it('creates tickets through the portal channel and serializes the created row', async () => {
    hoisted.mockCreateTicket.mockResolvedValue(ticketRow({ subject: 'Created from portal' }))

    const result = await createMyTicketFn({
      data: {
        subject: 'Created from portal',
        descriptionText: 'Details',
        priority: 'high',
      },
    })

    expect(hoisted.mockCreateTicket).toHaveBeenCalledWith({
      subject: 'Created from portal',
      descriptionJson: null,
      descriptionText: 'Details',
      priority: 'high',
      channel: 'portal',
      requesterPrincipalId: PRINCIPAL,
      createdByPrincipalId: PRINCIPAL,
    })
    expect(result).toEqual({
      id: TICKET,
      subject: 'Created from portal',
      statusId: STATUS_OPEN,
      statusCategory: 'open',
      statusName: 'Open',
      statusColor: '#16a34a',
      createdAt: CREATED.toISOString(),
      lastActivityAt: UPDATED.toISOString(),
    })
  })

  it('verifies portal ownership before creating the initial attachment thread', async () => {
    hoisted.mockAddPortalReply.mockResolvedValue({ id: 'thread_initial' })

    const result = await createTicketInitialThreadFn({ data: { ticketId: TICKET } })

    expect(hoisted.mockGetTicketForPortalUser).toHaveBeenCalledWith({
      userId: USER,
      ticketId: TICKET,
    })
    expect(hoisted.mockAddPortalReply).toHaveBeenCalledWith({
      userId: USER,
      ticketId: TICKET,
      bodyText: '[Attachments added at ticket creation]',
    })
    expect(result).toEqual({ id: 'thread_initial' })
  })
})
