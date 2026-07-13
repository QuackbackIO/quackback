import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, TicketId } from '@quackback/ids'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'

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
  mockGetTicket: vi.fn(),
  mockListSharesForTicket: vi.fn(),
  mockToResourceScope: vi.fn(),
  mockCanViewTicket: vi.fn(),
  mockLoadPermissionSet: vi.fn(),
  mockSubscribeToTicket: vi.fn(),
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
  policyActorFromAuth: vi.fn(),
}))

vi.mock('@/lib/server/domains/notifications/notification.service', () => ({
  getNotificationsForMember: vi.fn(),
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  archiveNotification: vi.fn(),
}))

vi.mock('@/lib/server/domains/tickets/ticket.subscriptions', () => ({
  subscribeToTicket: hoisted.mockSubscribeToTicket,
  unsubscribeFromTicket: vi.fn(),
  updateSubscriptionPrefs: vi.fn(),
  muteTicket: vi.fn(),
  unmuteTicket: vi.fn(),
  listSubscribersForTicket: vi.fn(),
  getSubscription: vi.fn(),
  listSubscriptionsForPrincipalWithTickets: vi.fn(),
}))

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  getTicket: hoisted.mockGetTicket,
}))

vi.mock('@/lib/server/domains/tickets/ticket.share', () => ({
  listSharesForTicket: hoisted.mockListSharesForTicket,
}))

vi.mock('@/lib/server/domains/tickets/ticket.permissions', () => ({
  canViewTicket: hoisted.mockCanViewTicket,
  toResourceScope: hoisted.mockToResourceScope,
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: hoisted.mockLoadPermissionSet,
}))

vi.mock('@/lib/shared/utils', () => ({
  toIsoString: (d: Date | string) => (typeof d === 'string' ? d : (d as Date).toISOString()),
  toIsoStringOrNull: (d: Date | string | null | undefined) =>
    d == null ? null : typeof d === 'string' ? d : (d as Date).toISOString(),
}))

const PRINCIPAL = 'principal_1' as PrincipalId
const TICKET = 'ticket_1' as TicketId

// subscribeToTicketFn is the first ticket-subscription fn; preceding handlers
// are the 5 notification fns (get, unread, markRead, markAll, archive).
const SUBSCRIBE_TO_TICKET = 5
let subscribeToTicketHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../notifications')
  }
  subscribeToTicketHandler = handlersByIndex[SUBSCRIBE_TO_TICKET]
  hoisted.mockRequireAuth.mockResolvedValue({ principal: { id: PRINCIPAL, role: 'member' } })
})

describe('assertCanViewTicket (via subscribeToTicketFn)', () => {
  it('throws NotFoundError when the ticket does not exist', async () => {
    hoisted.mockGetTicket.mockResolvedValue(null)

    await expect(subscribeToTicketHandler({ data: { ticketId: TICKET } })).rejects.toBeInstanceOf(
      NotFoundError
    )
    expect(hoisted.mockListSharesForTicket).not.toHaveBeenCalled()
    expect(hoisted.mockSubscribeToTicket).not.toHaveBeenCalled()
  })

  it('throws ForbiddenError when the ticket is visible but the principal lacks view permission', async () => {
    hoisted.mockGetTicket.mockResolvedValue({
      primaryTeamId: 'team_1',
      assigneePrincipalId: null,
      assigneeTeamId: null,
    })
    hoisted.mockListSharesForTicket.mockResolvedValue([{ teamId: 'team_2', revokedAt: null }])
    hoisted.mockToResourceScope.mockReturnValue({ scope: 'resolved' })
    hoisted.mockLoadPermissionSet.mockResolvedValue({ permissions: [] })
    hoisted.mockCanViewTicket.mockReturnValue(false)

    await expect(subscribeToTicketHandler({ data: { ticketId: TICKET } })).rejects.toBeInstanceOf(
      ForbiddenError
    )

    // The scope must be built from the ticket + its (mapped) shares.
    expect(hoisted.mockToResourceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryTeamId: 'team_1',
        shares: [{ teamId: 'team_2', revokedAt: null }],
      })
    )
    expect(hoisted.mockLoadPermissionSet).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.mockSubscribeToTicket).not.toHaveBeenCalled()
  })

  it('proceeds to subscribe when the principal can view the ticket', async () => {
    hoisted.mockGetTicket.mockResolvedValue({
      primaryTeamId: 'team_1',
      assigneePrincipalId: PRINCIPAL,
      assigneeTeamId: 'team_1',
    })
    hoisted.mockListSharesForTicket.mockResolvedValue([])
    hoisted.mockToResourceScope.mockReturnValue({ scope: 'resolved' })
    hoisted.mockLoadPermissionSet.mockResolvedValue({ permissions: ['view'] })
    hoisted.mockCanViewTicket.mockReturnValue(true)
    hoisted.mockSubscribeToTicket.mockResolvedValue({ id: 'sub_1', source: 'manual' })

    const result = (await subscribeToTicketHandler({
      data: { ticketId: TICKET, prefs: { notifyThreads: true } },
    })) as { id: string; source: string }

    expect(result).toEqual({ id: 'sub_1', source: 'manual' })
    expect(hoisted.mockSubscribeToTicket).toHaveBeenCalledWith({
      ticketId: TICKET,
      principalId: PRINCIPAL,
      source: 'manual',
      prefs: { notifyThreads: true },
    })
  })
})
