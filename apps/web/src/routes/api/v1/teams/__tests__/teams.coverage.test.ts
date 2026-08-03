import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

/**
 * Request-level behaviour tests for the teams REST route handlers.
 * Mirrors the canonical inboxes coverage test. Each route resolves its
 * domain service through a dynamic `await import(...)`, so we mock the
 * team.service module — Vitest hoists vi.mock above the route imports,
 * so the dynamic imports inside the handlers resolve to these mocks.
 */
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listTeamsMock: vi.fn(),
  createTeamMock: vi.fn(),
  getTeamMock: vi.fn(),
  updateTeamMock: vi.fn(),
  archiveTeamMock: vi.fn(),
  unarchiveTeamMock: vi.fn(),
  listMembersMock: vi.fn(),
  addMemberMock: vi.fn(),
  removeMemberMock: vi.fn(),
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

vi.mock('@/lib/server/domains/teams/team.service', () => ({
  listTeams: (...args: unknown[]) => hoisted.listTeamsMock(...args),
  createTeam: (...args: unknown[]) => hoisted.createTeamMock(...args),
  getTeam: (...args: unknown[]) => hoisted.getTeamMock(...args),
  updateTeam: (...args: unknown[]) => hoisted.updateTeamMock(...args),
  archiveTeam: (...args: unknown[]) => hoisted.archiveTeamMock(...args),
  unarchiveTeam: (...args: unknown[]) => hoisted.unarchiveTeamMock(...args),
  listMembers: (...args: unknown[]) => hoisted.listMembersMock(...args),
  addMember: (...args: unknown[]) => hoisted.addMemberMock(...args),
  removeMember: (...args: unknown[]) => hoisted.removeMemberMock(...args),
}))

import { Route as MemberDetailRoute } from '../$teamId.members.$principalId'
import { Route as MembersRoute } from '../$teamId.members'
import { Route as TeamDetailRoute } from '../$teamId'
import { Route as UnarchiveRoute } from '../$teamId.unarchive'
import { Route as TeamsRoute } from '../index'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const teamHandlers = (TeamsRoute as unknown as RouteWithHandlers).options.server.handlers
const teamDetailHandlers = (TeamDetailRoute as unknown as RouteWithHandlers).options.server.handlers
const unarchiveHandlers = (UnarchiveRoute as unknown as RouteWithHandlers).options.server.handlers
const memberHandlers = (MembersRoute as unknown as RouteWithHandlers).options.server.handlers
const memberDetailHandlers = (MemberDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_admin'
const TEAM = 'team_123'
const MEMBER_PRINCIPAL = 'principal_member'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/teams')
) {
  return { request, params: handlerParams }
}

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: TEAM,
    slug: 'support',
    name: 'Support',
    description: null,
    shortLabel: null,
    color: null,
    archivedAt: null,
    ...overrides,
  }
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    teamId: TEAM,
    principalId: MEMBER_PRINCIPAL,
    role: 'member',
    ...overrides,
  }
}

async function expectJsonData(response: Response) {
  return (await response.json()).data
}

/**
 * A request whose body is not valid JSON, so `request.json()` rejects and the
 * handler's `.catch(() => null)` fallback fires (exercising that callback before
 * safeParse rejects the null body with a 400).
 */
function malformedJsonRequest(url: string, method: string) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json{',
  })
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

describe('/api/v1/teams routes', () => {
  it('lists teams (default and includeArchived) after scope and permission checks', async () => {
    const row = team()
    hoisted.listTeamsMock.mockResolvedValue([row])

    // Default: includeArchived omitted -> false branch
    const listResponse = await teamHandlers.GET(args())
    expect(listResponse.status).toBe(200)
    expect(await expectJsonData(listResponse)).toEqual([row])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TEAM_VIEW
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(expect.any(Set), PERMISSIONS.TEAM_VIEW)
    expect(hoisted.listTeamsMock).toHaveBeenCalledWith({ includeArchived: false })

    // includeArchived=true -> true branch
    const archivedResponse = await teamHandlers.GET(
      args({}, new Request('http://test/api/v1/teams?includeArchived=true'))
    )
    expect(archivedResponse.status).toBe(200)
    expect(hoisted.listTeamsMock).toHaveBeenLastCalledWith({ includeArchived: true })
  })

  it('creates a team after scope and permission checks', async () => {
    const row = team()
    hoisted.createTeamMock.mockResolvedValue(row)

    const createResponse = await teamHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/teams', 'POST', {
          slug: 'support',
          name: 'Support',
          description: null,
          shortLabel: null,
          color: null,
        })
      )
    )
    expect(createResponse.status).toBe(201)
    expect(await expectJsonData(createResponse)).toEqual(row)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TEAM_MANAGE
    )
    expect(hoisted.createTeamMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'support', name: 'Support' }),
      { principalId: PRINCIPAL }
    )
  })

  it('rejects an invalid create body before calling the service', async () => {
    const response = await teamHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/teams', 'POST', { slug: 'support', name: '' }))
    )
    expect(response.status).toBe(400)
    expect(hoisted.createTeamMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed JSON create body via the null fallback', async () => {
    const response = await teamHandlers.POST(
      args({}, malformedJsonRequest('http://test/api/v1/teams', 'POST'))
    )
    expect(response.status).toBe(400)
    expect(hoisted.createTeamMock).not.toHaveBeenCalled()
  })

  it('denies list and create with 403 when permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const listResponse = await teamHandlers.GET(args())
    expect(listResponse.status).toBe(403)
    expect(hoisted.listTeamsMock).not.toHaveBeenCalled()

    const createResponse = await teamHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/teams', 'POST', { slug: 'support', name: 'Support' })
      )
    )
    expect(createResponse.status).toBe(403)
    expect(hoisted.createTeamMock).not.toHaveBeenCalled()
  })

  it('surfaces domain errors raised while listing as a mapped response', async () => {
    hoisted.listTeamsMock.mockRejectedValue({ code: 'CONFLICT', message: 'boom' })
    const response = await teamHandlers.GET(args())
    expect(response.status).toBe(409)
  })

  it('maps a domain error thrown by createTeam', async () => {
    hoisted.createTeamMock.mockRejectedValue({ code: 'CONFLICT', message: 'slug taken' })
    const response = await teamHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/teams', 'POST', { slug: 'support', name: 'Support' })
      )
    )
    expect(response.status).toBe(409)
  })
})

describe('/api/v1/teams/:teamId routes', () => {
  it('gets a team after scope and permission checks', async () => {
    const row = team({ name: 'Priority support' })
    hoisted.getTeamMock.mockResolvedValue(row)

    const response = await teamDetailHandlers.GET(args({ teamId: TEAM }))
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TEAM_VIEW
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TEAM, 'team', 'team ID')
    expect(hoisted.getTeamMock).toHaveBeenCalledWith(TEAM)
  })

  it('returns 404 when the team does not exist on GET', async () => {
    hoisted.getTeamMock.mockResolvedValue(null)
    const response = await teamDetailHandlers.GET(args({ teamId: TEAM }))
    expect(response.status).toBe(404)
  })

  it('patches a team after scope and permission checks', async () => {
    const row = team({ name: 'Renamed' })
    hoisted.updateTeamMock.mockResolvedValue(row)

    const response = await teamDetailHandlers.PATCH(
      args(
        { teamId: TEAM },
        jsonRequest('http://test/api/v1/teams/team_123', 'PATCH', { name: 'Renamed' })
      )
    )
    expect(response.status).toBe(200)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TEAM_MANAGE
    )
    expect(hoisted.updateTeamMock).toHaveBeenCalledWith(
      TEAM,
      { name: 'Renamed' },
      { principalId: PRINCIPAL }
    )
  })

  it('rejects an invalid patch body before calling the service', async () => {
    const response = await teamDetailHandlers.PATCH(
      args(
        { teamId: TEAM },
        jsonRequest('http://test/api/v1/teams/team_123', 'PATCH', { name: '' })
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.updateTeamMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed JSON patch body via the null fallback', async () => {
    const response = await teamDetailHandlers.PATCH(
      args({ teamId: TEAM }, malformedJsonRequest('http://test/api/v1/teams/team_123', 'PATCH'))
    )
    expect(response.status).toBe(400)
    expect(hoisted.updateTeamMock).not.toHaveBeenCalled()
  })

  it('archives a team via DELETE after scope and permission checks', async () => {
    hoisted.archiveTeamMock.mockResolvedValue(undefined)
    const response = await teamDetailHandlers.DELETE(args({ teamId: TEAM }))
    expect(response.status).toBe(204)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TEAM_MANAGE
    )
    expect(hoisted.archiveTeamMock).toHaveBeenCalledWith(TEAM, { principalId: PRINCIPAL })
  })

  it('denies GET, PATCH, and DELETE with 403 when permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const getResponse = await teamDetailHandlers.GET(args({ teamId: TEAM }))
    expect(getResponse.status).toBe(403)
    expect(hoisted.getTeamMock).not.toHaveBeenCalled()

    const patchResponse = await teamDetailHandlers.PATCH(
      args({ teamId: TEAM }, jsonRequest('http://test/api/v1/teams/team_123', 'PATCH', {}))
    )
    expect(patchResponse.status).toBe(403)
    expect(hoisted.updateTeamMock).not.toHaveBeenCalled()

    const deleteResponse = await teamDetailHandlers.DELETE(args({ teamId: TEAM }))
    expect(deleteResponse.status).toBe(403)
    expect(hoisted.archiveTeamMock).not.toHaveBeenCalled()
  })

  it('maps a domain error thrown by parseTypeId on GET', async () => {
    hoisted.parseTypeIdMock.mockImplementation(() => {
      throw { code: 'VALIDATION_ERROR', message: 'Invalid team ID format' }
    })
    const response = await teamDetailHandlers.GET(args({ teamId: 'bad' }))
    expect(response.status).toBe(400)
    expect(hoisted.getTeamMock).not.toHaveBeenCalled()
  })

  it('maps a domain error thrown by updateTeam on PATCH', async () => {
    hoisted.updateTeamMock.mockRejectedValue({ code: 'NOT_FOUND', message: 'gone' })
    const response = await teamDetailHandlers.PATCH(
      args(
        { teamId: TEAM },
        jsonRequest('http://test/api/v1/teams/team_123', 'PATCH', { name: 'Renamed' })
      )
    )
    expect(response.status).toBe(404)
  })

  it('maps a domain error thrown by archiveTeam on DELETE', async () => {
    hoisted.archiveTeamMock.mockRejectedValue({ code: 'CONFLICT', message: 'cannot archive' })
    const response = await teamDetailHandlers.DELETE(args({ teamId: TEAM }))
    expect(response.status).toBe(409)
  })
})

describe('/api/v1/teams/:teamId/unarchive route', () => {
  it('unarchives a team and returns the restored row', async () => {
    const row = team({ archivedAt: null })
    hoisted.unarchiveTeamMock.mockResolvedValue(undefined)
    hoisted.getTeamMock.mockResolvedValue(row)

    const response = await unarchiveHandlers.POST(args({ teamId: TEAM }))
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TEAM_MANAGE
    )
    expect(hoisted.unarchiveTeamMock).toHaveBeenCalledWith(TEAM, { principalId: PRINCIPAL })
    expect(hoisted.getTeamMock).toHaveBeenCalledWith(TEAM)
  })

  it('returns 404 when the team cannot be reloaded after unarchive', async () => {
    hoisted.unarchiveTeamMock.mockResolvedValue(undefined)
    hoisted.getTeamMock.mockResolvedValue(null)

    const response = await unarchiveHandlers.POST(args({ teamId: TEAM }))
    expect(response.status).toBe(404)
  })

  it('denies unarchive with 403 when permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await unarchiveHandlers.POST(args({ teamId: TEAM }))
    expect(response.status).toBe(403)
    expect(hoisted.unarchiveTeamMock).not.toHaveBeenCalled()
  })

  it('maps a domain error thrown by unarchiveTeam', async () => {
    hoisted.unarchiveTeamMock.mockRejectedValue({ code: 'NOT_FOUND', message: 'gone' })
    const response = await unarchiveHandlers.POST(args({ teamId: TEAM }))
    expect(response.status).toBe(404)
  })
})

describe('/api/v1/teams/:teamId/members routes', () => {
  it('lists members after scope and permission checks', async () => {
    const row = member()
    hoisted.listMembersMock.mockResolvedValue([row])

    const response = await memberHandlers.GET(args({ teamId: TEAM }))
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual([row])
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TEAM_VIEW
    )
    expect(hoisted.listMembersMock).toHaveBeenCalledWith(TEAM)
  })

  it('adds a member with an explicit role', async () => {
    const row = member({ role: 'lead' })
    hoisted.addMemberMock.mockResolvedValue(row)

    const response = await memberHandlers.POST(
      args(
        { teamId: TEAM },
        jsonRequest('http://test/api/v1/teams/team_123/members', 'POST', {
          principalId: MEMBER_PRINCIPAL,
          role: 'lead',
        })
      )
    )
    expect(response.status).toBe(201)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TEAM_MANAGE
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(
      MEMBER_PRINCIPAL,
      'principal',
      'principal ID'
    )
    expect(hoisted.addMemberMock).toHaveBeenCalledWith(TEAM, MEMBER_PRINCIPAL, 'lead')
  })

  it('adds a member defaulting the role to member when omitted', async () => {
    const row = member()
    hoisted.addMemberMock.mockResolvedValue(row)

    const response = await memberHandlers.POST(
      args(
        { teamId: TEAM },
        jsonRequest('http://test/api/v1/teams/team_123/members', 'POST', {
          principalId: MEMBER_PRINCIPAL,
        })
      )
    )
    expect(response.status).toBe(201)
    // role omitted -> nullish-coalescing default branch ('member')
    expect(hoisted.addMemberMock).toHaveBeenCalledWith(TEAM, MEMBER_PRINCIPAL, 'member')
  })

  it('rejects an invalid add-member body before calling the service', async () => {
    const response = await memberHandlers.POST(
      args(
        { teamId: TEAM },
        jsonRequest('http://test/api/v1/teams/team_123/members', 'POST', {
          principalId: '',
          role: 'member',
        })
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.addMemberMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed JSON add-member body via the null fallback', async () => {
    const response = await memberHandlers.POST(
      args(
        { teamId: TEAM },
        malformedJsonRequest('http://test/api/v1/teams/team_123/members', 'POST')
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.addMemberMock).not.toHaveBeenCalled()
  })

  it('denies list and add-member with 403 when permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const listResponse = await memberHandlers.GET(args({ teamId: TEAM }))
    expect(listResponse.status).toBe(403)
    expect(hoisted.listMembersMock).not.toHaveBeenCalled()

    const addResponse = await memberHandlers.POST(
      args(
        { teamId: TEAM },
        jsonRequest('http://test/api/v1/teams/team_123/members', 'POST', {
          principalId: MEMBER_PRINCIPAL,
        })
      )
    )
    expect(addResponse.status).toBe(403)
    expect(hoisted.addMemberMock).not.toHaveBeenCalled()
  })

  it('maps a domain error thrown by listMembers', async () => {
    hoisted.listMembersMock.mockRejectedValue({ code: 'NOT_FOUND', message: 'gone' })
    const response = await memberHandlers.GET(args({ teamId: TEAM }))
    expect(response.status).toBe(404)
  })

  it('maps a domain error thrown by addMember', async () => {
    hoisted.addMemberMock.mockRejectedValue({ code: 'CONFLICT', message: 'already a member' })
    const response = await memberHandlers.POST(
      args(
        { teamId: TEAM },
        jsonRequest('http://test/api/v1/teams/team_123/members', 'POST', {
          principalId: MEMBER_PRINCIPAL,
        })
      )
    )
    expect(response.status).toBe(409)
  })
})

describe('/api/v1/teams/:teamId/members/:principalId route', () => {
  it('removes a member after scope and permission checks', async () => {
    hoisted.removeMemberMock.mockResolvedValue(undefined)

    const response = await memberDetailHandlers.DELETE(
      args({ teamId: TEAM, principalId: MEMBER_PRINCIPAL })
    )
    expect(response.status).toBe(204)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TEAM_MANAGE
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TEAM, 'team', 'team ID')
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(
      MEMBER_PRINCIPAL,
      'principal',
      'principal ID'
    )
    expect(hoisted.removeMemberMock).toHaveBeenCalledWith(TEAM, MEMBER_PRINCIPAL)
  })

  it('denies member removal with 403 when permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await memberDetailHandlers.DELETE(
      args({ teamId: TEAM, principalId: MEMBER_PRINCIPAL })
    )
    expect(response.status).toBe(403)
    expect(hoisted.removeMemberMock).not.toHaveBeenCalled()
  })

  it('maps a domain error thrown by removeMember', async () => {
    hoisted.removeMemberMock.mockRejectedValue({ code: 'NOT_FOUND', message: 'gone' })
    const response = await memberDetailHandlers.DELETE(
      args({ teamId: TEAM, principalId: MEMBER_PRINCIPAL })
    )
    expect(response.status).toBe(404)
  })
})
