import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, TeamId, TicketId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/server/domains/authz'
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
  mockRequireAuthWithPermissions: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockListTickets: vi.fn(),
  mockCreateTicket: vi.fn(),
  mockGetTicket: vi.fn(),
  mockUpdateTicket: vi.fn(),
  mockAssignTicket: vi.fn(),
  mockTransitionStatus: vi.fn(),
  mockSoftDeleteTicket: vi.fn(),
  mockAddThread: vi.fn(),
  mockListThreads: vi.fn(),
  mockShareTicketWithTeam: vi.fn(),
  mockRevokeShare: vi.fn(),
  mockListSharesForTicket: vi.fn(),
  mockAddParticipant: vi.fn(),
  mockRemoveParticipant: vi.fn(),
  mockListParticipants: vi.fn(),
  mockToResourceScope: vi.fn(),
  mockCanViewTicket: vi.fn(),
  mockCanReplyPublic: vi.fn(),
  mockCanCommentInternal: vi.fn(),
  mockCanEditFields: vi.fn(),
  mockCanAssign: vi.fn(),
  mockCanAssignSelf: vi.fn(),
  mockCanShareCrossTeam: vi.fn(),
  mockCanManageParticipants: vi.fn(),
  mockTakeTicket: vi.fn(),
  mockReturnTicket: vi.fn(),
  mockBulkAssign: vi.fn(),
  mockBulkTransition: vi.fn(),
  mockBulkChangeInbox: vi.fn(),
  mockListTicketStatuses: vi.fn(),
  mockHasPermissionForResource: vi.fn(),
  mockDbSelect: vi.fn(),
  mockEq: vi.fn(),
  mockAnd: vi.fn(),
  mockLt: vi.fn(),
  mockDesc: vi.fn(),
  mockInArray: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuthWithPermissions: hoisted.mockRequireAuthWithPermissions,
  requirePermission: hoisted.mockRequirePermission,
}))

vi.mock('@/lib/server/domains/tickets', () => ({
  createTicket: hoisted.mockCreateTicket,
  getTicket: hoisted.mockGetTicket,
  updateTicket: hoisted.mockUpdateTicket,
  assignTicket: hoisted.mockAssignTicket,
  transitionStatus: hoisted.mockTransitionStatus,
  softDeleteTicket: hoisted.mockSoftDeleteTicket,
  addThread: hoisted.mockAddThread,
  listThreads: hoisted.mockListThreads,
  shareTicketWithTeam: hoisted.mockShareTicketWithTeam,
  revokeShare: hoisted.mockRevokeShare,
  listSharesForTicket: hoisted.mockListSharesForTicket,
  addParticipant: hoisted.mockAddParticipant,
  removeParticipant: hoisted.mockRemoveParticipant,
  listParticipants: hoisted.mockListParticipants,
  listTickets: hoisted.mockListTickets,
  toResourceScope: hoisted.mockToResourceScope,
  canViewTicket: hoisted.mockCanViewTicket,
  canReplyPublic: hoisted.mockCanReplyPublic,
  canCommentInternal: hoisted.mockCanCommentInternal,
  canEditFields: hoisted.mockCanEditFields,
  canAssign: hoisted.mockCanAssign,
  canAssignSelf: hoisted.mockCanAssignSelf,
  canShareCrossTeam: hoisted.mockCanShareCrossTeam,
  canManageParticipants: hoisted.mockCanManageParticipants,
  takeTicket: hoisted.mockTakeTicket,
  returnTicket: hoisted.mockReturnTicket,
  bulkAssign: hoisted.mockBulkAssign,
  bulkTransition: hoisted.mockBulkTransition,
  bulkChangeInbox: hoisted.mockBulkChangeInbox,
}))

vi.mock('@/lib/server/domains/tickets/ticket-statuses.service', () => ({
  listTicketStatuses: hoisted.mockListTicketStatuses,
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  hasPermissionForResource: hoisted.mockHasPermissionForResource,
}))

vi.mock('@/lib/server/db', () => ({
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  TICKET_CHANNELS: ['web', 'email', 'chat', 'api'],
  TICKET_VISIBILITY_SCOPES: ['workspace', 'team', 'private'],
  TICKET_THREAD_AUDIENCES: ['public', 'internal', 'shared_team'],
  TICKET_SHARE_LEVELS: ['read', 'comment'],
  TICKET_PARTICIPANT_ROLES: ['requester', 'cc', 'follower'],
  db: {
    select: (...args: unknown[]) => hoisted.mockDbSelect(...args),
  },
  ticketActivity: {
    id: 'ticketActivity.id',
    ticketId: 'ticketActivity.ticketId',
    principalId: 'ticketActivity.principalId',
    type: 'ticketActivity.type',
    metadata: 'ticketActivity.metadata',
    createdAt: 'ticketActivity.createdAt',
  },
  principal: {
    id: 'principal.id',
    displayName: 'principal.displayName',
    avatarUrl: 'principal.avatarUrl',
  },
  eq: (...args: unknown[]) => hoisted.mockEq(...args),
  and: (...args: unknown[]) => hoisted.mockAnd(...args),
  lt: (...args: unknown[]) => hoisted.mockLt(...args),
  desc: (...args: unknown[]) => hoisted.mockDesc(...args),
  inArray: (...args: unknown[]) => hoisted.mockInArray(...args),
}))

const PRINCIPAL = 'principal_agent' as PrincipalId
const OTHER_PRINCIPAL = 'principal_other' as PrincipalId
const TICKET = 'ticket_123' as TicketId
const TEAM = 'team_support' as TeamId
const RESOURCE_SCOPE = { kind: 'ticket-scope', teamId: TEAM }
const PERMISSION_SET = { teamIds: [TEAM], permissions: new Set<string>() }

await import('../tickets')

const [
  listTicketsFn,
  createTicketFn,
  getTicketFn,
  updateTicketFn,
  assignTicketFn,
  transitionTicketStatusFn,
  softDeleteTicketFn,
  addThreadFn,
  listThreadsFn,
  shareTicketFn,
  revokeShareFn,
  listSharesFn,
  addParticipantFn,
  removeParticipantFn,
  listParticipantsFn,
  takeTicketFn,
  returnTicketFn,
  bulkAssignTicketsFn,
  bulkTransitionTicketsFn,
  bulkChangeInboxFn,
  listTicketStatusesFn,
  listTicketActivityFn,
  manualSyncTicketFn,
  createTicketInitialThreadFn,
] = handlersByIndex

if (!createTicketInitialThreadFn) {
  throw new Error(`tickets handlers were not registered; found ${handlersByIndex.length}`)
}

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    subject: 'Need help',
    primaryTeamId: TEAM,
    assigneePrincipalId: null,
    assigneeTeamId: null,
    requesterPrincipalId: OTHER_PRINCIPAL,
    ...overrides,
  }
}

function authContext() {
  return {
    principal: { id: PRINCIPAL, role: 'member' },
    permissions: PERMISSION_SET,
  }
}

function principalSelectChain(rows: readonly Record<string, unknown>[]) {
  const where = vi.fn().mockResolvedValue(rows)
  const from = vi.fn(() => ({ where }))
  return { from, where }
}

function activitySelectChain(rows: readonly Record<string, unknown>[]) {
  const chain = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
  }
  chain.from.mockReturnValue(chain)
  chain.leftJoin.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.orderBy.mockReturnValue(chain)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuthWithPermissions.mockResolvedValue(authContext())
  hoisted.mockRequirePermission.mockResolvedValue(authContext())
  hoisted.mockGetTicket.mockResolvedValue(ticketRow())
  hoisted.mockListSharesForTicket.mockResolvedValue([])
  hoisted.mockToResourceScope.mockReturnValue(RESOURCE_SCOPE)
  hoisted.mockCanViewTicket.mockReturnValue(true)
  hoisted.mockCanReplyPublic.mockReturnValue(true)
  hoisted.mockCanCommentInternal.mockReturnValue(true)
  hoisted.mockCanEditFields.mockReturnValue(true)
  hoisted.mockCanAssign.mockReturnValue(true)
  hoisted.mockCanAssignSelf.mockReturnValue(false)
  hoisted.mockCanShareCrossTeam.mockReturnValue(true)
  hoisted.mockCanManageParticipants.mockReturnValue(true)
  hoisted.mockHasPermissionForResource.mockReturnValue(true)
})

describe('ticket queue and create server functions', () => {
  it('lists tickets with permission context and normalized optional filters', async () => {
    hoisted.mockListTickets.mockResolvedValue([{ id: TICKET }])

    const result = await listTicketsFn({
      data: {
        scope: 'my_team',
        statusCategory: 'open',
        search: 'billing',
        inboxId: null,
        organizationId: null,
        requesterContactId: null,
        limit: 25,
        offset: 5,
        sort: 'created_desc',
      },
    })

    expect(result).toEqual([{ id: TICKET }])
    expect(hoisted.mockListTickets).toHaveBeenCalledWith({
      scope: 'my_team',
      permissionSet: PERMISSION_SET,
      statusCategory: 'open',
      search: 'billing',
      inboxId: undefined,
      organizationId: undefined,
      requesterContactId: undefined,
      limit: 25,
      offset: 5,
      sort: 'created_desc',
    })
  })

  it('creates tickets as the authenticated requester after edit-field permission passes', async () => {
    hoisted.mockCreateTicket.mockResolvedValue(ticketRow({ subject: 'Created' }))

    const result = await createTicketFn({
      data: {
        subject: 'Created',
        descriptionText: 'Details',
        priority: 'normal',
        channel: 'web',
      },
    })

    expect(result).toMatchObject({ subject: 'Created' })
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.TICKET_EDIT_FIELDS)
    expect(hoisted.mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Created',
        descriptionJson: null,
        createdByPrincipalId: PRINCIPAL,
        requesterPrincipalId: PRINCIPAL,
      })
    )
  })
})

describe('ticket read and update server functions', () => {
  it('loads shares into the resource scope before returning a ticket', async () => {
    hoisted.mockListSharesForTicket.mockResolvedValue([{ teamId: TEAM, revokedAt: null }])

    const result = await getTicketFn({ data: { ticketId: TICKET } })

    expect(result).toMatchObject({ id: TICKET })
    expect(hoisted.mockToResourceScope).toHaveBeenCalledWith({
      primaryTeamId: TEAM,
      assigneePrincipalId: null,
      assigneeTeamId: null,
      shares: [{ teamId: TEAM, revokedAt: null }],
    })
    expect(hoisted.mockCanViewTicket).toHaveBeenCalledWith(PERMISSION_SET, RESOURCE_SCOPE)
  })

  it('denies ticket reads before returning data when the actor cannot view the scope', async () => {
    hoisted.mockCanViewTicket.mockReturnValue(false)

    await expect(getTicketFn({ data: { ticketId: TICKET } })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('updates tickets with conflict timestamp and actor metadata when edit is allowed', async () => {
    hoisted.mockUpdateTicket.mockResolvedValue(ticketRow({ subject: 'Updated' }))

    await updateTicketFn({
      data: {
        ticketId: TICKET,
        expectedUpdatedAt: '2026-03-01T00:00:00.000Z',
        subject: 'Updated',
      },
    })

    expect(hoisted.mockUpdateTicket).toHaveBeenCalledWith(
      TICKET,
      expect.objectContaining({
        subject: 'Updated',
        expectedUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
        actorPrincipalId: PRINCIPAL,
        allowStaleFieldUpdate: true,
      })
    )
  })

  it('denies updates before calling the mutation when edit permission fails', async () => {
    hoisted.mockCanEditFields.mockReturnValue(false)

    await expect(
      updateTicketFn({
        data: { ticketId: TICKET, expectedUpdatedAt: '2026-03-01T00:00:00.000Z' },
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(hoisted.mockUpdateTicket).not.toHaveBeenCalled()
  })
})

describe('assignment and status server functions', () => {
  it('allows self-assignment through the assign-self fallback', async () => {
    hoisted.mockCanAssign.mockReturnValue(false)
    hoisted.mockCanAssignSelf.mockReturnValue(true)
    hoisted.mockAssignTicket.mockResolvedValue(ticketRow({ assigneePrincipalId: PRINCIPAL }))

    await assignTicketFn({
      data: {
        ticketId: TICKET,
        expectedUpdatedAt: '2026-03-01T00:00:00.000Z',
        assigneePrincipalId: PRINCIPAL,
      },
    })

    expect(hoisted.mockCanAssignSelf).toHaveBeenCalledWith(PERMISSION_SET, RESOURCE_SCOPE)
    expect(hoisted.mockAssignTicket).toHaveBeenCalledWith(
      TICKET,
      expect.objectContaining({
        actorPrincipalId: PRINCIPAL,
        assigneePrincipalId: PRINCIPAL,
        assigneeTeamId: null,
      })
    )
  })

  it('denies assigning another principal when assign-any is missing', async () => {
    hoisted.mockCanAssign.mockReturnValue(false)

    await expect(
      assignTicketFn({
        data: {
          ticketId: TICKET,
          expectedUpdatedAt: '2026-03-01T00:00:00.000Z',
          assigneePrincipalId: OTHER_PRINCIPAL,
        },
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(hoisted.mockCanAssignSelf).not.toHaveBeenCalled()
    expect(hoisted.mockAssignTicket).not.toHaveBeenCalled()
  })

  it('transitions status and soft-deletes through edit-field authorization', async () => {
    await transitionTicketStatusFn({
      data: {
        ticketId: TICKET,
        expectedUpdatedAt: '2026-03-01T00:00:00.000Z',
        statusId: 'status_solved',
      },
    })
    await softDeleteTicketFn({ data: { ticketId: TICKET } })

    expect(hoisted.mockTransitionStatus).toHaveBeenCalledWith(
      TICKET,
      expect.objectContaining({
        actorPrincipalId: PRINCIPAL,
        statusId: 'status_solved',
      })
    )
    expect(hoisted.mockSoftDeleteTicket).toHaveBeenCalledWith(TICKET, PRINCIPAL)
  })
})

describe('thread server functions', () => {
  it('adds public threads only when public reply permission passes', async () => {
    hoisted.mockAddThread.mockResolvedValue({ id: 'thread_public' })

    await addThreadFn({
      data: {
        ticketId: TICKET,
        audience: 'public',
        bodyText: 'Reply',
      },
    })

    expect(hoisted.mockCanReplyPublic).toHaveBeenCalledWith(PERMISSION_SET, RESOURCE_SCOPE)
    expect(hoisted.mockAddThread).toHaveBeenCalledWith({
      ticketId: TICKET,
      principalId: PRINCIPAL,
      audience: 'public',
      bodyJson: null,
      bodyText: 'Reply',
      sharedWithTeamId: null,
    })
  })

  it('denies internal comments when the actor cannot comment internally', async () => {
    hoisted.mockCanCommentInternal.mockReturnValue(false)

    await expect(
      addThreadFn({ data: { ticketId: TICKET, audience: 'internal', bodyText: 'Private' } })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('denies shared-team notes when cross-team sharing is unavailable', async () => {
    hoisted.mockCanShareCrossTeam.mockReturnValue(false)

    await expect(
      addThreadFn({
        data: {
          ticketId: TICKET,
          audience: 'shared_team',
          bodyText: 'Shared note',
          sharedWithTeamId: TEAM,
        },
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('lists visible threads with viewer flags and principal display names', async () => {
    hoisted.mockGetTicket.mockResolvedValue(ticketRow({ requesterPrincipalId: PRINCIPAL }))
    hoisted.mockListThreads.mockResolvedValue([
      { id: 'thread_1', principalId: PRINCIPAL },
      { id: 'thread_2', principalId: OTHER_PRINCIPAL },
      { id: 'thread_3', principalId: null },
    ])
    hoisted.mockDbSelect.mockReturnValueOnce(
      principalSelectChain([{ id: PRINCIPAL, displayName: ' Agent Smith ' }])
    )

    const result = await listThreadsFn({ data: { ticketId: TICKET } })

    expect(hoisted.mockListThreads).toHaveBeenCalledWith(TICKET, {
      viewerTeamIds: [TEAM],
      canSeeInternal: true,
      isRequester: true,
    })
    expect(result).toEqual([
      { id: 'thread_1', principalId: PRINCIPAL, principalName: 'Agent Smith' },
      { id: 'thread_2', principalId: OTHER_PRINCIPAL, principalName: 'Unknown' },
      { id: 'thread_3', principalId: null, principalName: null },
    ])
  })
})

describe('share and participant server functions', () => {
  it('shares tickets only when cross-team sharing is allowed', async () => {
    hoisted.mockShareTicketWithTeam.mockResolvedValue({ id: 'share_1' })

    await shareTicketFn({
      data: { ticketId: TICKET, teamId: TEAM, accessLevel: 'comment' },
    })

    expect(hoisted.mockShareTicketWithTeam).toHaveBeenCalledWith({
      ticketId: TICKET,
      teamId: TEAM,
      accessLevel: 'comment',
      grantedByPrincipalId: PRINCIPAL,
    })
  })

  it('denies listing shares when the ticket is not visible', async () => {
    hoisted.mockCanViewTicket.mockReturnValue(false)

    await expect(listSharesFn({ data: { ticketId: TICKET } })).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })

  it('revokes shares with the authenticated actor id', async () => {
    await revokeShareFn({ data: { shareId: 'share_1' } })

    expect(hoisted.mockRevokeShare).toHaveBeenCalledWith('share_1', PRINCIPAL)
  })

  it('adds, removes, and lists participants through the participant gate', async () => {
    hoisted.mockAddParticipant.mockResolvedValue({ id: 'participant_1' })
    hoisted.mockListParticipants.mockResolvedValue([{ id: 'participant_1' }])

    await addParticipantFn({
      data: {
        ticketId: TICKET,
        role: 'cc',
        principalId: OTHER_PRINCIPAL,
      },
    })
    const listed = await listParticipantsFn({ data: { ticketId: TICKET } })
    const removed = await removeParticipantFn({
      data: { ticketId: TICKET, participantId: 'participant_1' },
    })

    expect(hoisted.mockAddParticipant).toHaveBeenCalledWith({
      ticketId: TICKET,
      role: 'cc',
      principalId: OTHER_PRINCIPAL,
      contactId: null,
      addedByPrincipalId: PRINCIPAL,
    })
    expect(listed).toEqual([{ id: 'participant_1' }])
    expect(removed).toEqual({ ok: true })
    expect(hoisted.mockRemoveParticipant).toHaveBeenCalledWith('participant_1', PRINCIPAL)
  })
})

describe('take, return, bulk, and catalogue server functions', () => {
  it('gates take and return on resource-scoped assignment permissions', async () => {
    hoisted.mockHasPermissionForResource.mockImplementation(
      (_set, permission) => permission === PERMISSIONS.TICKET_ASSIGN_SELF
    )
    hoisted.mockTakeTicket.mockResolvedValue(ticketRow({ assigneePrincipalId: PRINCIPAL }))
    hoisted.mockReturnTicket.mockResolvedValue(ticketRow({ assigneePrincipalId: null }))

    await takeTicketFn({ data: { ticketId: TICKET } })
    await returnTicketFn({ data: { ticketId: TICKET } })

    expect(hoisted.mockTakeTicket).toHaveBeenCalledWith(TICKET, PRINCIPAL)
    expect(hoisted.mockReturnTicket).toHaveBeenCalledWith(TICKET, PRINCIPAL)
  })

  it('denies returning a ticket when neither self nor assign-any permission matches', async () => {
    hoisted.mockHasPermissionForResource.mockReturnValue(false)

    await expect(returnTicketFn({ data: { ticketId: TICKET } })).rejects.toBeInstanceOf(
      ForbiddenError
    )

    expect(hoisted.mockReturnTicket).not.toHaveBeenCalled()
  })

  it('passes resource permit callbacks into bulk ticket operations', async () => {
    hoisted.mockHasPermissionForResource.mockImplementation(
      (_set, permission) => permission === PERMISSIONS.TICKET_ASSIGN_ANY
    )
    hoisted.mockBulkAssign.mockImplementation(async (input) => ({
      permitted: input.permit(RESOURCE_SCOPE),
    }))
    hoisted.mockBulkTransition.mockImplementation(async (input) => ({
      permitted: input.permit(RESOURCE_SCOPE),
    }))
    hoisted.mockBulkChangeInbox.mockImplementation(async (input) => ({
      permitted: input.permit(RESOURCE_SCOPE),
    }))

    const assign = await bulkAssignTicketsFn({
      data: { ticketIds: [TICKET], assigneePrincipalId: OTHER_PRINCIPAL },
    })
    const transition = await bulkTransitionTicketsFn({
      data: { ticketIds: [TICKET], statusId: 'status_pending' },
    })
    const inbox = await bulkChangeInboxFn({
      data: { ticketIds: [TICKET], inboxId: null },
    })

    expect(assign).toEqual({ permitted: true })
    expect(transition).toEqual({ permitted: false })
    expect(inbox).toEqual({ permitted: false })
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.TICKET_BULK_OPERATE)
  })

  it('lists ticket statuses after authenticating', async () => {
    hoisted.mockListTicketStatuses.mockResolvedValue([{ id: 'status_open' }])

    const result = await listTicketStatusesFn({ data: {} })

    expect(result).toEqual([{ id: 'status_open' }])
    expect(hoisted.mockRequireAuthWithPermissions).toHaveBeenCalled()
  })
})

describe('ticket activity and helper server functions', () => {
  it('lists activity with before cursor filtering and actor fields', async () => {
    const rows = [
      {
        id: 'activity_1',
        ticketId: TICKET,
        principalId: PRINCIPAL,
        type: 'ticket.updated',
        metadata: { subject: 'Updated' },
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        actorName: 'Agent',
        actorAvatarUrl: null,
      },
    ]
    const chain = activitySelectChain(rows)
    hoisted.mockDbSelect.mockReturnValueOnce(chain)

    const result = await listTicketActivityFn({
      data: {
        ticketId: TICKET,
        before: '2026-03-02T00:00:00.000Z',
        limit: 10,
      },
    })

    expect(result).toEqual(rows)
    expect(chain.limit).toHaveBeenCalledWith(10)
    expect(hoisted.mockLt).toHaveBeenCalledWith(
      'ticketActivity.createdAt',
      new Date('2026-03-02T00:00:00.000Z')
    )
  })

  it('returns the manual sync not-implemented response after edit permission passes', async () => {
    const result = await manualSyncTicketFn({
      data: {
        ticketId: TICKET,
        integrationId: 'integration_1',
        direction: 'push',
      },
    })

    expect(result).toEqual({ success: false, error: 'Manual sync not yet implemented' })
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.TICKET_EDIT_FIELDS)
  })

  it('creates an initial public thread for ticket creation attachments', async () => {
    hoisted.mockAddThread.mockResolvedValue({ id: 'thread_initial' })

    const result = await createTicketInitialThreadFn({ data: { ticketId: TICKET } })

    expect(result).toEqual({ id: 'thread_initial' })
    expect(hoisted.mockAddThread).toHaveBeenCalledWith({
      ticketId: TICKET,
      principalId: PRINCIPAL,
      audience: 'public',
      bodyText: '[Attachments added at ticket creation]',
    })
  })
})
