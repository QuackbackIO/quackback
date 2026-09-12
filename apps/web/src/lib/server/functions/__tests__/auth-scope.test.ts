import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const mockGetSession = vi.fn()
vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const mockPrincipalFindFirst = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
    },
  },
  principal: {},
  eq: vi.fn(),
}))

vi.mock('../auth-request-cache', () => ({
  memoizePerRequest: (_key: string, fn: () => unknown) => fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  requireSettingsCached: vi.fn(async () => ({
    id: 'workspace_1',
    slug: 'main',
    name: 'Main',
    logoKey: null,
  })),
}))

vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  ensurePrincipalForUser: vi.fn(),
}))

vi.mock('@/lib/server/policy/permissions', () => ({
  permissionsForPrincipal: vi.fn(async () => new Set([PERMISSIONS.SETTINGS_MANAGE])),
}))

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: vi.fn(async () => new Set()),
}))

import { assertPermission, getOptionalAuth, requireAuth } from '../auth-helpers'
import { ensurePrincipalForUser } from '@/lib/server/domains/principals/principal.factory'
import { toSessionScope } from '@/lib/shared/roles'

function sessionWithScope(scope: string) {
  return {
    session: { id: 'sess_1', scope },
    user: { id: 'user_1', email: 'ada@example.com', name: 'Ada', image: null },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin', type: 'user' })
  vi.mocked(ensurePrincipalForUser).mockResolvedValue({
    principal: { id: 'principal_1', role: 'admin', type: 'user' } as never,
    created: false,
  })
})

describe('requireAuth permission gates are dashboard-only', () => {
  it('denies a widget session even after the principal was promoted to admin', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('widget'))

    await expect(requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })).rejects.toThrow(
      /dashboard session/
    )
  })

  it('denies a portal session at a permission gate', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('portal'))

    await expect(requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })).rejects.toThrow(
      /dashboard session/
    )
  })

  it('allows the same principal on a dashboard session', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))

    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    expect(auth.scope).toBe('dashboard')
    expect(auth.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE)
  })

  it('bare requireAuth stays cross-plane but strips team authority from widget scope', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('widget'))

    const auth = await requireAuth()
    expect(auth.scope).toBe('widget')
    expect(auth.principal.role).toBe('user')
    expect(auth.permissions).toEqual([])
  })

  it('keeps the team role and permissions on a dashboard session', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))

    const auth = await requireAuth()
    expect(auth.principal.role).toBe('admin')
    expect(auth.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE)
  })
})

describe('getOptionalAuth strips team authority from non-dashboard scopes', () => {
  it('downgrades a promoted widget principal to the portal tier', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('widget'))

    const auth = await getOptionalAuth()
    expect(auth?.scope).toBe('widget')
    expect(auth?.principal.role).toBe('user')
    expect(auth?.permissions).toEqual([])
  })

  it('keeps the team role on a dashboard session', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))

    const auth = await getOptionalAuth()
    expect(auth?.principal.role).toBe('admin')
    expect(auth?.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE)
  })
})

describe('assertPermission scope gate', () => {
  it('denies a widget session holding the permission', () => {
    expect(() =>
      assertPermission(
        {
          permissions: [PERMISSIONS.SETTINGS_MANAGE],
          principal: { id: 'principal_1', role: 'admin', type: 'user' },
          scope: 'widget',
        },
        PERMISSIONS.SETTINGS_MANAGE
      )
    ).toThrow(/dashboard session/)
  })

  it('allows a dashboard session holding the permission', () => {
    expect(() =>
      assertPermission(
        {
          permissions: [PERMISSIONS.SETTINGS_MANAGE],
          principal: { id: 'principal_1', role: 'admin', type: 'user' },
          scope: 'dashboard',
        },
        PERMISSIONS.SETTINGS_MANAGE
      )
    ).not.toThrow()
  })
})

describe('toSessionScope', () => {
  it('maps known scopes', () => {
    expect(toSessionScope('widget')).toBe('widget')
    expect(toSessionScope('portal')).toBe('portal')
    expect(toSessionScope('dashboard')).toBe('dashboard')
  })

  it('treats unknown values as dashboard', () => {
    expect(toSessionScope(undefined)).toBe('dashboard')
    expect(toSessionScope(null)).toBe('dashboard')
    expect(toSessionScope('future')).toBe('dashboard')
  })
})
