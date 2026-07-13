import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  createInboxMock: vi.fn(),
  updateInboxMock: vi.fn(),
  archiveInboxMock: vi.fn(),
  getInboxMock: vi.fn(),
  listInboxesMock: vi.fn(),
  addInboxMembershipMock: vi.fn(),
  updateInboxMembershipRoleMock: vi.fn(),
  removeInboxMembershipMock: vi.fn(),
  listMembershipsForInboxMock: vi.fn(),
  addInboxChannelMock: vi.fn(),
  updateInboxChannelMock: vi.fn(),
  archiveInboxChannelMock: vi.fn(),
  listChannelsForInboxMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
  assertScopeAllowed: (...args: unknown[]) => hoisted.assertScopeAllowedMock(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => hoisted.loadPermissionSetMock(...args),
  hasPermission: (...args: unknown[]) => hoisted.hasPermissionMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/inboxes', () => ({
  createInbox: (...args: unknown[]) => hoisted.createInboxMock(...args),
  updateInbox: (...args: unknown[]) => hoisted.updateInboxMock(...args),
  archiveInbox: (...args: unknown[]) => hoisted.archiveInboxMock(...args),
  getInbox: (...args: unknown[]) => hoisted.getInboxMock(...args),
  listInboxes: (...args: unknown[]) => hoisted.listInboxesMock(...args),
  addInboxMembership: (...args: unknown[]) => hoisted.addInboxMembershipMock(...args),
  updateInboxMembershipRole: (...args: unknown[]) => hoisted.updateInboxMembershipRoleMock(...args),
  removeInboxMembership: (...args: unknown[]) => hoisted.removeInboxMembershipMock(...args),
  listMembershipsForInbox: (...args: unknown[]) => hoisted.listMembershipsForInboxMock(...args),
  addInboxChannel: (...args: unknown[]) => hoisted.addInboxChannelMock(...args),
  updateInboxChannel: (...args: unknown[]) => hoisted.updateInboxChannelMock(...args),
  archiveInboxChannel: (...args: unknown[]) => hoisted.archiveInboxChannelMock(...args),
  listChannelsForInbox: (...args: unknown[]) => hoisted.listChannelsForInboxMock(...args),
}))

vi.mock('@/lib/server/db', () => ({
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  TICKET_VISIBILITY_SCOPES: ['workspace', 'team', 'private'],
  INBOX_CHANNEL_KINDS: ['email', 'widget', 'api'],
  INBOX_MEMBERSHIP_ROLES: ['owner', 'agent', 'observer'],
}))

import { Route as ChannelDetailRoute } from '../$inboxId.channels.$channelId'
import { Route as ChannelsRoute } from '../$inboxId.channels'
import { Route as InboxDetailRoute } from '../$inboxId'
import { Route as MembershipDetailRoute } from '../$inboxId.memberships.$membershipId'
import { Route as MembershipsRoute } from '../$inboxId.memberships'
import { Route as InboxesRoute } from '../index'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const inboxHandlers = (InboxesRoute as unknown as RouteWithHandlers).options.server.handlers
const inboxDetailHandlers = (InboxDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers
const channelHandlers = (ChannelsRoute as unknown as RouteWithHandlers).options.server.handlers
const channelDetailHandlers = (ChannelDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers
const membershipHandlers = (MembershipsRoute as unknown as RouteWithHandlers).options.server
  .handlers
const membershipDetailHandlers = (MembershipDetailRoute as unknown as RouteWithHandlers).options
  .server.handlers

const PRINCIPAL = 'principal_admin'
const INBOX = 'inbox_123'
const CHANNEL = 'inbox_ch_123'
const MEMBERSHIP = 'inbox_mem_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/inboxes')
) {
  return { request, params: handlerParams }
}

function inbox(overrides: Record<string, unknown> = {}) {
  return {
    id: INBOX,
    slug: 'support',
    name: 'Support',
    archivedAt: null,
    ...overrides,
  }
}

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: CHANNEL,
    inboxId: INBOX,
    kind: 'email',
    label: 'Support email',
    enabled: true,
    ...overrides,
  }
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: MEMBERSHIP,
    inboxId: INBOX,
    principalId: 'principal_agent',
    role: 'agent',
    ...overrides,
  }
}

async function expectJsonData(response: Response) {
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'team',
    key: { scopes: [] },
  })
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.hasPermissionMock.mockReturnValue(true)
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
})

describe('/api/v1/inboxes routes', () => {
  it('lists and creates inboxes after scope and permission checks', async () => {
    const row = inbox()
    hoisted.listInboxesMock.mockResolvedValue([row])
    hoisted.createInboxMock.mockResolvedValue(row)

    const listResponse = await inboxHandlers.GET(
      args({}, new Request('http://test/api/v1/inboxes?includeArchived=true'))
    )
    expect(listResponse.status).toBe(200)
    expect(await expectJsonData(listResponse)).toEqual([row])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.INBOX_VIEW
    )
    expect(hoisted.listInboxesMock).toHaveBeenCalledWith({ includeArchived: true })

    const createResponse = await inboxHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/inboxes', 'POST', {
          slug: 'support',
          name: 'Support',
          description: null,
          primaryTeamId: null,
          defaultVisibilityScope: 'team',
          defaultPriority: 'urgent',
          defaultStatusId: null,
          color: null,
          icon: null,
        })
      )
    )
    expect(createResponse.status).toBe(201)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.INBOX_MANAGE
    )
    expect(hoisted.createInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'support', name: 'Support', defaultPriority: 'urgent' }),
      { principalId: PRINCIPAL }
    )
  })

  it('gets, patches, archives, and returns not found for inbox details', async () => {
    const row = inbox({ name: 'Priority support' })
    hoisted.getInboxMock.mockResolvedValueOnce(row).mockResolvedValueOnce(null)
    hoisted.updateInboxMock.mockResolvedValue(row)
    hoisted.archiveInboxMock.mockResolvedValue(row)

    const getResponse = await inboxDetailHandlers.GET(args({ inboxId: INBOX }))
    expect(getResponse.status).toBe(200)
    expect(await expectJsonData(getResponse)).toEqual(row)
    expect(hoisted.getInboxMock).toHaveBeenCalledWith(INBOX)

    const notFoundResponse = await inboxDetailHandlers.GET(args({ inboxId: INBOX }))
    expect(notFoundResponse.status).toBe(404)

    const patchResponse = await inboxDetailHandlers.PATCH(
      args(
        { inboxId: INBOX },
        jsonRequest('http://test/api/v1/inboxes/inbox_123', 'PATCH', {
          name: 'Priority support',
          defaultStatusId: null,
        })
      )
    )
    expect(patchResponse.status).toBe(200)
    expect(hoisted.updateInboxMock).toHaveBeenCalledWith(
      INBOX,
      { name: 'Priority support', defaultStatusId: null },
      { principalId: PRINCIPAL }
    )

    const deleteResponse = await inboxDetailHandlers.DELETE(args({ inboxId: INBOX }))
    expect(deleteResponse.status).toBe(204)
    expect(hoisted.archiveInboxMock).toHaveBeenCalledWith(INBOX, { principalId: PRINCIPAL })
  })

  it('lists, creates, patches, and archives inbox channels', async () => {
    const row = channel()
    hoisted.listChannelsForInboxMock.mockResolvedValue([row])
    hoisted.addInboxChannelMock.mockResolvedValue(row)
    hoisted.updateInboxChannelMock.mockResolvedValue(row)
    hoisted.archiveInboxChannelMock.mockResolvedValue(row)

    const listResponse = await channelHandlers.GET(args({ inboxId: INBOX }))
    expect(listResponse.status).toBe(200)
    expect(await expectJsonData(listResponse)).toEqual([row])
    expect(hoisted.listChannelsForInboxMock).toHaveBeenCalledWith(INBOX)

    const createResponse = await channelHandlers.POST(
      args(
        { inboxId: INBOX },
        jsonRequest('http://test/api/v1/inboxes/inbox_123/channels', 'POST', {
          kind: 'email',
          label: 'Support email',
          config: { address: 'support@example.com' },
          externalId: null,
          enabled: true,
        })
      )
    )
    expect(createResponse.status).toBe(201)
    expect(hoisted.addInboxChannelMock).toHaveBeenCalledWith({
      inboxId: INBOX,
      kind: 'email',
      label: 'Support email',
      config: { address: 'support@example.com' },
      externalId: null,
      enabled: true,
    })

    const patchResponse = await channelDetailHandlers.PATCH(
      args(
        { inboxId: INBOX, channelId: CHANNEL },
        jsonRequest('http://test/api/v1/inboxes/inbox_123/channels/inbox_ch_123', 'PATCH', {
          label: 'Renamed channel',
          enabled: false,
        })
      )
    )
    expect(patchResponse.status).toBe(200)
    expect(hoisted.updateInboxChannelMock).toHaveBeenCalledWith(CHANNEL, {
      label: 'Renamed channel',
      enabled: false,
    })

    const deleteResponse = await channelDetailHandlers.DELETE(
      args({ inboxId: INBOX, channelId: CHANNEL })
    )
    expect(deleteResponse.status).toBe(204)
    expect(hoisted.archiveInboxChannelMock).toHaveBeenCalledWith(CHANNEL)
  })

  it('lists, creates, patches, and removes inbox memberships', async () => {
    const row = membership()
    hoisted.listMembershipsForInboxMock.mockResolvedValue([row])
    hoisted.addInboxMembershipMock.mockResolvedValue(row)
    hoisted.updateInboxMembershipRoleMock.mockResolvedValue(row)
    hoisted.removeInboxMembershipMock.mockResolvedValue(undefined)

    const listResponse = await membershipHandlers.GET(args({ inboxId: INBOX }))
    expect(listResponse.status).toBe(200)
    expect(await expectJsonData(listResponse)).toEqual([row])
    expect(hoisted.listMembershipsForInboxMock).toHaveBeenCalledWith(INBOX)

    const createResponse = await membershipHandlers.POST(
      args(
        { inboxId: INBOX },
        jsonRequest('http://test/api/v1/inboxes/inbox_123/memberships', 'POST', {
          principalId: 'principal_agent',
          role: 'agent',
        })
      )
    )
    expect(createResponse.status).toBe(201)
    expect(hoisted.addInboxMembershipMock).toHaveBeenCalledWith({
      inboxId: INBOX,
      principalId: 'principal_agent',
      role: 'agent',
    })

    const patchResponse = await membershipDetailHandlers.PATCH(
      args(
        { inboxId: INBOX, membershipId: MEMBERSHIP },
        jsonRequest('http://test/api/v1/inboxes/inbox_123/memberships/inbox_mem_123', 'PATCH', {
          role: 'owner',
        })
      )
    )
    expect(patchResponse.status).toBe(200)
    expect(hoisted.updateInboxMembershipRoleMock).toHaveBeenCalledWith(MEMBERSHIP, 'owner')

    const deleteResponse = await membershipDetailHandlers.DELETE(
      args({ inboxId: INBOX, membershipId: MEMBERSHIP })
    )
    expect(deleteResponse.status).toBe(204)
    expect(hoisted.removeInboxMembershipMock).toHaveBeenCalledWith(MEMBERSHIP)
  })

  it('returns 403 before domain calls when each handler permission check fails', async () => {
    const cases = [
      [inboxHandlers.GET, args()],
      [inboxHandlers.POST, args({}, jsonRequest('http://test/api/v1/inboxes', 'POST', {}))],
      [inboxDetailHandlers.GET, args({ inboxId: INBOX })],
      [
        inboxDetailHandlers.PATCH,
        args({ inboxId: INBOX }, jsonRequest('http://test/api/v1/inboxes/inbox_123', 'PATCH', {})),
      ],
      [inboxDetailHandlers.DELETE, args({ inboxId: INBOX })],
      [channelHandlers.GET, args({ inboxId: INBOX })],
      [
        channelHandlers.POST,
        args(
          { inboxId: INBOX },
          jsonRequest('http://test/api/v1/inboxes/inbox_123/channels', 'POST', {})
        ),
      ],
      [channelDetailHandlers.PATCH, args({ inboxId: INBOX, channelId: CHANNEL })],
      [channelDetailHandlers.DELETE, args({ inboxId: INBOX, channelId: CHANNEL })],
      [membershipHandlers.GET, args({ inboxId: INBOX })],
      [
        membershipHandlers.POST,
        args(
          { inboxId: INBOX },
          jsonRequest('http://test/api/v1/inboxes/inbox_123/memberships', 'POST', {})
        ),
      ],
      [membershipDetailHandlers.PATCH, args({ inboxId: INBOX, membershipId: MEMBERSHIP })],
      [membershipDetailHandlers.DELETE, args({ inboxId: INBOX, membershipId: MEMBERSHIP })],
    ] as const

    for (const [handler, handlerArgs] of cases) {
      hoisted.hasPermissionMock.mockReturnValueOnce(false)
      const response = await handler(handlerArgs)
      expect(response.status).toBe(403)
    }

    expect(hoisted.createInboxMock).not.toHaveBeenCalled()
    expect(hoisted.updateInboxMock).not.toHaveBeenCalled()
    expect(hoisted.archiveInboxMock).not.toHaveBeenCalled()
    expect(hoisted.addInboxChannelMock).not.toHaveBeenCalled()
    expect(hoisted.updateInboxChannelMock).not.toHaveBeenCalled()
    expect(hoisted.archiveInboxChannelMock).not.toHaveBeenCalled()
    expect(hoisted.addInboxMembershipMock).not.toHaveBeenCalled()
    expect(hoisted.updateInboxMembershipRoleMock).not.toHaveBeenCalled()
    expect(hoisted.removeInboxMembershipMock).not.toHaveBeenCalled()
  })

  it('rejects invalid request bodies before mutating inbox resources', async () => {
    const cases = [
      [
        inboxHandlers.POST,
        args({}, jsonRequest('http://test/api/v1/inboxes', 'POST', { name: '' })),
      ],
      [
        inboxDetailHandlers.PATCH,
        args(
          { inboxId: INBOX },
          jsonRequest('http://test/api/v1/inboxes/inbox_123', 'PATCH', {
            name: '',
          })
        ),
      ],
      [
        channelHandlers.POST,
        args(
          { inboxId: INBOX },
          jsonRequest('http://test/api/v1/inboxes/inbox_123/channels', 'POST', {
            kind: 'email',
            label: '',
          })
        ),
      ],
      [
        channelDetailHandlers.PATCH,
        args(
          { inboxId: INBOX, channelId: CHANNEL },
          jsonRequest('http://test/api/v1/inboxes/inbox_123/channels/inbox_ch_123', 'PATCH', {
            label: '',
          })
        ),
      ],
      [
        membershipHandlers.POST,
        args(
          { inboxId: INBOX },
          jsonRequest('http://test/api/v1/inboxes/inbox_123/memberships', 'POST', {
            principalId: '',
            role: 'agent',
          })
        ),
      ],
      [
        membershipDetailHandlers.PATCH,
        args(
          { inboxId: INBOX, membershipId: MEMBERSHIP },
          jsonRequest('http://test/api/v1/inboxes/inbox_123/memberships/inbox_mem_123', 'PATCH', {
            role: 'invalid',
          })
        ),
      ],
    ] as const

    for (const [handler, handlerArgs] of cases) {
      const response = await handler(handlerArgs)
      expect(response.status).toBe(400)
    }

    expect(hoisted.createInboxMock).not.toHaveBeenCalled()
    expect(hoisted.updateInboxMock).not.toHaveBeenCalled()
    expect(hoisted.addInboxChannelMock).not.toHaveBeenCalled()
    expect(hoisted.updateInboxChannelMock).not.toHaveBeenCalled()
    expect(hoisted.addInboxMembershipMock).not.toHaveBeenCalled()
    expect(hoisted.updateInboxMembershipRoleMock).not.toHaveBeenCalled()
  })
})
