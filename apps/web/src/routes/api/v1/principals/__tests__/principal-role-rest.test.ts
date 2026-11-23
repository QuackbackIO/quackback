/**
 * PATCH / DELETE /api/v1/principals/:principalId: the REST face of adding a
 * signed-in portal user to the team and of undoing it. The service owns the
 * rules (tested against real Postgres in update-member-role-promote.db.test);
 * the route must hand it the key owner's role for the Admin grant ceiling and
 * an API actor so the change is audited, and answer with the new teammate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockUpdateMemberRole = vi.fn()
const mockRemoveTeamMember = vi.fn()
const mockGetMemberById = vi.fn()
const mockUserFindFirst = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  updateMemberRole: (...args: unknown[]) => mockUpdateMemberRole(...args),
  removeTeamMember: (...args: unknown[]) => mockRemoveTeamMember(...args),
  getMemberById: (...args: unknown[]) => mockGetMemberById(...args),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: { user: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) } } },
}))

import { Route } from '../$principalId'

type Handler = (args: { request: Request; params: { principalId: string } }) => Promise<Response>
type RouteOpts = { server: { handlers: { PATCH: Handler; DELETE: Handler } } }
const { PATCH, DELETE } = (Route as unknown as { options: RouteOpts }).options.server.handlers

const TARGET = createId('principal')
const AUTH_CONTEXT = {
  apiKey: { id: 'api_key_01jz000000000000000000test' },
  principalId: createId('principal'),
  role: 'member',
  // The key's resolved authority, narrower than the member preset.
  permissions: new Set(['member.manage', 'post.view_private']),
  principal: { userId: 'user_owner', user: { email: 'owner@example.com' } },
  importMode: false,
}

function request(method: string, body?: Record<string, unknown>): Request {
  return new Request(`http://test/api/v1/principals/${TARGET}`, {
    method,
    headers: { 'content-type': 'application/json', 'user-agent': 'rest-test' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithApiKeyAuth.mockResolvedValue(AUTH_CONTEXT)
  mockUpdateMemberRole.mockResolvedValue(undefined)
  mockRemoveTeamMember.mockResolvedValue(undefined)
  mockGetMemberById.mockResolvedValue({
    id: TARGET,
    userId: 'user_target',
    role: 'member',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  })
  mockUserFindFirst.mockResolvedValue({
    id: 'user_target',
    name: 'Target',
    email: 'target@example.com',
    image: null,
  })
})

describe('PATCH /api/v1/principals/:principalId', () => {
  it("passes the key owner's role for the Admin ceiling and an API actor for the audit", async () => {
    const res = await PATCH({
      request: request('PATCH', { role: 'member' }),
      params: { principalId: TARGET },
    })

    expect(res.status).toBe(200)
    expect(mockUpdateMemberRole).toHaveBeenCalledOnce()
    const [principalId, role, acting, actor, headers, opts] = mockUpdateMemberRole.mock.calls[0]
    expect(principalId).toBe(TARGET)
    expect(role).toBe('member')
    expect(acting).toBe(AUTH_CONTEXT.principalId)
    expect(actor).toEqual({
      userId: 'user_owner',
      email: 'owner@example.com',
      role: 'member',
      type: 'api_key',
      authMethod: 'api_key',
    })
    expect((headers as Headers).get('user-agent')).toBe('rest-test')
    expect(opts).toMatchObject({ granterRole: 'member' })
    // The grant ceiling is the key's resolved set, never a preset of its role.
    expect(opts.granterPermissions).toEqual(['member.manage', 'post.view_private'])
    const body = (await res.json()) as { data: { id: string; role: string } }
    expect(body.data).toMatchObject({ id: TARGET, role: 'member' })
  })

  it('maps a seat shortfall to 402 with the needed and free counts', async () => {
    const { SeatLimitError } = await import('@/lib/server/domains/principals/seat-limit')
    mockUpdateMemberRole.mockRejectedValue(
      new SeatLimitError({ needed: 1, free: 0, used: 3, max: 3 })
    )

    const res = await PATCH({
      request: request('PATCH', { role: 'member' }),
      params: { principalId: TARGET },
    })

    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ needed: 1, free: 0, limit: 'maxTeamSeats' })
  })
})

describe('DELETE /api/v1/principals/:principalId', () => {
  it('audits the removal with the API actor', async () => {
    const res = await DELETE({ request: request('DELETE'), params: { principalId: TARGET } })

    expect(res.status).toBe(204)
    const [principalId, acting, actor] = mockRemoveTeamMember.mock.calls[0]
    expect(principalId).toBe(TARGET)
    expect(acting).toBe(AUTH_CONTEXT.principalId)
    expect(actor).toMatchObject({ type: 'api_key', userId: 'user_owner' })
    // Only an admin key removes an admin: the service gets the key owner's role.
    expect(mockRemoveTeamMember.mock.calls[0][4]).toEqual({ granterRole: 'member' })
  })
})

describe('a personal key and the person it acts for', () => {
  const keyMadeBy = (creatorId: string, kind: 'personal' | 'workspace' = 'personal') => ({
    ...AUTH_CONTEXT,
    apiKey: { id: 'api_key_01jz000000000000000000test', kind, createdById: creatorId },
    role: 'admin',
  })

  it("refuses to change its own creator's role, as the app refuses a self change", async () => {
    mockWithApiKeyAuth.mockResolvedValue(keyMadeBy(TARGET))

    const res = await PATCH({
      request: request('PATCH', { role: 'member' }),
      params: { principalId: TARGET },
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'FORBIDDEN', message: 'You cannot change your own role' },
    })
    expect(mockUpdateMemberRole).not.toHaveBeenCalled()
  })

  it('refuses to remove its own creator from the team', async () => {
    mockWithApiKeyAuth.mockResolvedValue(keyMadeBy(TARGET))

    const res = await DELETE({ request: request('DELETE'), params: { principalId: TARGET } })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'FORBIDDEN', message: 'You cannot remove yourself from the team' },
    })
    expect(mockRemoveTeamMember).not.toHaveBeenCalled()
  })

  it('a workspace key belongs to nobody, so the admin who made it can be changed with it', async () => {
    mockWithApiKeyAuth.mockResolvedValue(keyMadeBy(TARGET, 'workspace'))

    const res = await PATCH({
      request: request('PATCH', { role: 'member' }),
      params: { principalId: TARGET },
    })

    expect(res.status).toBe(200)
    expect(mockUpdateMemberRole).toHaveBeenCalledOnce()
  })
})
