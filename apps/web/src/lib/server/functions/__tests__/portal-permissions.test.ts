/**
 * getMyPortalPermissionsFn: the portal layout's render-only permission
 * payload. Pins the boundary contract — team roles get their resolved
 * catalogue grant, everyone else (end users, anonymous principals,
 * logged-out visitors) gets [] and the fn never throws, because it runs
 * inside the public portal loader. Enforcement is elsewhere
 * (requireAuth({ permission })); this only decides what UI renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, UserId, WorkspaceId } from '@quackback/ids'
import { SYSTEM_ROLE_PERMISSIONS } from '@/lib/shared/permissions'
import type { AuthContext } from '../auth-helpers'

const hoisted = vi.hoisted(() => ({
  mockGetOptionalAuth: vi.fn(),
  mockHasSessionCookie: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: hoisted.mockGetOptionalAuth,
  hasSessionCookie: hoisted.mockHasSessionCookie,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

type AnyHandler = () => Promise<unknown>

const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

function buildAuth(overrides: {
  role: 'admin' | 'member' | 'user'
  principalType?: string
}): AuthContext {
  return {
    settings: {
      id: 'workspace_main' as WorkspaceId,
      slug: 'main',
      name: 'Main',
      logoKey: null,
    },
    user: {
      id: 'user_test' as UserId,
      email: 'test@example.com',
      name: 'Test',
      image: null,
    },
    principal: {
      id: 'principal_test' as PrincipalId,
      role: overrides.role,
      type: overrides.principalType ?? 'user',
    },
    // Model getOptionalAuth's contract: it attaches the gate-resolved
    // (assignment-derived) set, which for preset holders equals the preset.
    permissions: [
      ...(overrides.role === 'admin'
        ? SYSTEM_ROLE_PERMISSIONS.owner
        : overrides.role === 'member'
          ? SYSTEM_ROLE_PERMISSIONS.manager
          : []),
    ],
  }
}

let getMyPortalPermissionsHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  hoisted.mockHasSessionCookie.mockReturnValue(true)
  if (handlers.length === 0) await import('../portal-permissions')
  getMyPortalPermissionsHandler = handlers[0]
})

describe('getMyPortalPermissionsFn', () => {
  it('returns [] without a DB read when there is no session cookie', async () => {
    hoisted.mockHasSessionCookie.mockReturnValue(false)

    await expect(getMyPortalPermissionsHandler()).resolves.toEqual([])
    expect(hoisted.mockGetOptionalAuth).not.toHaveBeenCalled()
  })

  it('returns [] when the cookie resolves to no auth (stale/invalid session)', async () => {
    hoisted.mockGetOptionalAuth.mockResolvedValueOnce(null)

    await expect(getMyPortalPermissionsHandler()).resolves.toEqual([])
  })

  it('returns [] for an end user (role user)', async () => {
    hoisted.mockGetOptionalAuth.mockResolvedValueOnce(buildAuth({ role: 'user' }))

    await expect(getMyPortalPermissionsHandler()).resolves.toEqual([])
  })

  it('returns [] for an anonymous principal regardless of role', async () => {
    hoisted.mockGetOptionalAuth.mockResolvedValueOnce(
      buildAuth({ role: 'admin', principalType: 'anonymous' })
    )

    await expect(getMyPortalPermissionsHandler()).resolves.toEqual([])
  })

  it('returns the owner-preset grant for the admin role', async () => {
    hoisted.mockGetOptionalAuth.mockResolvedValueOnce(buildAuth({ role: 'admin' }))

    const keys = (await getMyPortalPermissionsHandler()) as string[]
    expect(new Set(keys)).toEqual(new Set(SYSTEM_ROLE_PERMISSIONS.owner))
  })

  it('returns the manager-preset grant for the member role', async () => {
    hoisted.mockGetOptionalAuth.mockResolvedValueOnce(buildAuth({ role: 'member' }))

    const keys = (await getMyPortalPermissionsHandler()) as string[]
    expect(new Set(keys)).toEqual(new Set(SYSTEM_ROLE_PERMISSIONS.manager))
    expect(keys).not.toContain('billing.manage')
  })

  it('never throws: an auth resolution failure degrades to []', async () => {
    hoisted.mockGetOptionalAuth.mockRejectedValueOnce(new Error('db down'))

    await expect(getMyPortalPermissionsHandler()).resolves.toEqual([])
  })
})
