/**
 * Differential-coverage tests for auth-helpers.
 *
 * Drives the real requireAuth / getOptionalAuth / requirePermission /
 * requireAuthWithPermissions exports so that:
 *   - readRequestContext parses cf-connecting-ip, x-forwarded-for fallback,
 *     user-agent truncation, the all-null case, and the throwing catch path
 *   - getOptionalAuth threads ipAddress/userAgent into its return value
 *   - requirePermission resolves both the resource-scoped and unscoped checks,
 *     allowing on success and throwing ForbiddenError on denial
 *   - requireAuthWithPermissions returns the loaded permission set
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetRequestHeaders: vi.fn(),
  mockGetSettings: vi.fn(),
  mockPrincipalFindFirst: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockGenerateId: vi.fn(() => 'principal_generated'),
  mockLoadPermissionSet: vi.fn(),
  mockHasPermission: vi.fn(),
  mockHasPermissionForResource: vi.fn(),
  mockSegmentIdsForPrincipal: vi.fn(),
}))

vi.mock('@/lib/server/auth', () => ({
  auth: {
    api: {
      getSession: hoisted.mockGetSession,
    },
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: hoisted.mockGetRequestHeaders,
}))

vi.mock('../workspace', () => ({
  getSettings: hoisted.mockGetSettings,
}))

vi.mock('@quackback/ids', () => ({
  generateId: hoisted.mockGenerateId,
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: hoisted.mockPrincipalFindFirst },
    },
    insert: () => ({
      values: () => ({
        returning: hoisted.mockInsertReturning,
      }),
    }),
  },
  principal: { userId: 'principal.userId' },
  eq: vi.fn(() => 'eq'),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: hoisted.mockLoadPermissionSet,
  hasPermission: hoisted.mockHasPermission,
  hasPermissionForResource: hoisted.mockHasPermissionForResource,
}))

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: hoisted.mockSegmentIdsForPrincipal,
}))

import {
  requireAuth,
  getOptionalAuth,
  requirePermission,
  requireAuthWithPermissions,
} from '../auth-helpers'
import { ForbiddenError } from '@/lib/shared/errors'

const SESSION = {
  user: { id: 'user_1', email: 'u@x.com', name: 'User', image: 'img.png' },
}
const SETTINGS = { id: 'ws_1', slug: 'main', name: 'Main', logoKey: 'logo.png' }
const PRINCIPAL = { id: 'principal_1', role: 'admin', type: 'user' }

/** Header map keyed for the Record-style index access readRequestContext uses. */
function headers(map: Record<string, string | string[]>) {
  return map as unknown as Headers
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockGetSession.mockResolvedValue(SESSION)
  hoisted.mockGetSettings.mockResolvedValue(SETTINGS)
  hoisted.mockPrincipalFindFirst.mockResolvedValue(PRINCIPAL)
  hoisted.mockGetRequestHeaders.mockReturnValue(headers({}))
})

describe('requireAuth — readRequestContext header parsing', () => {
  it('prefers cf-connecting-ip and truncates a long user-agent', async () => {
    const longUa = 'a'.repeat(600)
    hoisted.mockGetRequestHeaders.mockReturnValue(
      headers({
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.1, 10.0.0.1',
        'user-agent': longUa,
      })
    )

    const ctx = await requireAuth()

    expect(ctx.ipAddress).toBe('203.0.113.7')
    expect(ctx.userAgent).toHaveLength(500)
    expect(ctx.principal.id).toBe('principal_1')
    expect(ctx.settings.logoKey).toBe('logo.png')
  })

  it('falls back to the first x-forwarded-for hop when cf header is absent', async () => {
    hoisted.mockGetRequestHeaders.mockReturnValue(
      headers({
        'x-forwarded-for': '198.51.100.1, 10.0.0.1',
        'user-agent': 'short-ua',
      })
    )

    const ctx = await requireAuth()

    expect(ctx.ipAddress).toBe('198.51.100.1')
    expect(ctx.userAgent).toBe('short-ua')
  })

  it('handles array-valued headers by taking the first entry', async () => {
    hoisted.mockGetRequestHeaders.mockReturnValue(
      headers({
        'cf-connecting-ip': ['192.0.2.5', '192.0.2.6'],
        'user-agent': ['ua-one', 'ua-two'],
      })
    )

    const ctx = await requireAuth()

    expect(ctx.ipAddress).toBe('192.0.2.5')
    expect(ctx.userAgent).toBe('ua-one')
  })

  it('returns null ip/ua when no relevant headers are present', async () => {
    hoisted.mockGetRequestHeaders.mockReturnValue(headers({}))

    const ctx = await requireAuth()

    expect(ctx.ipAddress).toBeNull()
    expect(ctx.userAgent).toBeNull()
  })

  it('falls back to null ip/ua when getRequestHeaders throws', async () => {
    // First call (getSessionDirect) returns valid headers; the later call
    // inside readRequestContext throws → the catch returns the null pair.
    hoisted.mockGetRequestHeaders.mockReturnValueOnce(headers({})).mockImplementationOnce(() => {
      throw new Error('headers unavailable')
    })

    const ctx = await requireAuth()

    expect(ctx.ipAddress).toBeNull()
    expect(ctx.userAgent).toBeNull()
  })
})

describe('getOptionalAuth — request context + return shape', () => {
  it('threads ip/ua into the returned context for an existing principal', async () => {
    hoisted.mockGetRequestHeaders.mockReturnValue(
      headers({ 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'opt-ua' })
    )

    const ctx = await getOptionalAuth()

    expect(ctx).not.toBeNull()
    expect(ctx?.ipAddress).toBe('203.0.113.9')
    expect(ctx?.userAgent).toBe('opt-ua')
    expect(ctx?.principal.id).toBe('principal_1')
    expect(ctx?.user.email).toBe('u@x.com')
    expect(ctx?.source).toBe('web')
  })

  it('auto-creates a principal and still threads ip/ua on return', async () => {
    hoisted.mockPrincipalFindFirst.mockResolvedValue(undefined)
    hoisted.mockInsertReturning.mockResolvedValue([
      { id: 'principal_generated', role: 'user', type: 'user' },
    ])
    hoisted.mockGetRequestHeaders.mockReturnValue(headers({ 'x-forwarded-for': '198.51.100.2' }))

    const ctx = await getOptionalAuth()

    expect(hoisted.mockGenerateId).toHaveBeenCalledWith('principal')
    expect(ctx?.principal.id).toBe('principal_generated')
    expect(ctx?.principal.role).toBe('user')
    expect(ctx?.ipAddress).toBe('198.51.100.2')
  })

  it('returns null for an anonymous request', async () => {
    hoisted.mockGetSession.mockResolvedValue(null)
    const ctx = await getOptionalAuth()
    expect(ctx).toBeNull()
  })
})

describe('requirePermission', () => {
  it('allows when an unscoped permission is held', async () => {
    const set = { roleScopes: [] }
    hoisted.mockLoadPermissionSet.mockResolvedValue(set)
    hoisted.mockHasPermission.mockReturnValue(true)

    const ctx = await requirePermission('ticket.reply.public' as never)

    expect(hoisted.mockHasPermission).toHaveBeenCalledWith(set, 'ticket.reply.public')
    expect(hoisted.mockHasPermissionForResource).not.toHaveBeenCalled()
    expect(ctx.permissions).toBe(set)
    expect(ctx.principal.id).toBe('principal_1')
  })

  it('evaluates the resource scope when a resource is supplied', async () => {
    const set = { roleScopes: [] }
    hoisted.mockLoadPermissionSet.mockResolvedValue(set)
    hoisted.mockHasPermissionForResource.mockReturnValue(true)

    const ctx = await requirePermission(
      'ticket.reply.public' as never,
      {
        primaryTeamId: 'team_1',
      } as never
    )

    expect(hoisted.mockHasPermissionForResource).toHaveBeenCalledWith(set, 'ticket.reply.public', {
      primaryTeamId: 'team_1',
    })
    expect(hoisted.mockHasPermission).not.toHaveBeenCalled()
    expect(ctx.permissions).toBe(set)
  })

  it('throws ForbiddenError when the permission is missing', async () => {
    hoisted.mockLoadPermissionSet.mockResolvedValue({ roleScopes: [] })
    hoisted.mockHasPermission.mockReturnValue(false)

    await expect(requirePermission('ticket.delete' as never)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('throws ForbiddenError when the resource-scoped permission is denied', async () => {
    hoisted.mockLoadPermissionSet.mockResolvedValue({ roleScopes: [] })
    hoisted.mockHasPermissionForResource.mockReturnValue(false)

    await expect(
      requirePermission('ticket.delete' as never, { primaryTeamId: 'team_x' } as never)
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('requireAuthWithPermissions', () => {
  it('returns the auth context plus the loaded permission set without enforcing', async () => {
    const set = { roleScopes: ['x'] }
    hoisted.mockLoadPermissionSet.mockResolvedValue(set)

    const ctx = await requireAuthWithPermissions()

    expect(hoisted.mockLoadPermissionSet).toHaveBeenCalledWith('principal_1')
    expect(hoisted.mockHasPermission).not.toHaveBeenCalled()
    expect(ctx.permissions).toBe(set)
    expect(ctx.principal.role).toBe('admin')
  })
})
