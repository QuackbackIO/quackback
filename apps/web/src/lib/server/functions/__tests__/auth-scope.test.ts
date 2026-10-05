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

vi.mock('@/lib/server/request-memo', () => ({
  memoizePerRequest: (_key: string, fn: () => unknown) => fn(),
  derivedMemoKey: (base: string, name: string) => `${base}#${name}`,
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

import {
  assertDashboardScope,
  assertPermission,
  getOptionalAuth,
  requireAuth,
} from '../auth-helpers'
import { ensurePrincipalForUser } from '@/lib/server/domains/principals/principal.factory'
import { SESSION_AUDIENCE_HEADER, sessionRole, toSessionScope } from '@/lib/shared/roles'
import { assignSessionScope } from '@/lib/server/auth/session-audience'

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
      /Widget sessions cannot access this resource/
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

  it('bare requireAuth denies widget by default', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('widget'))

    await expect(requireAuth()).rejects.toThrow(/Widget sessions cannot access this resource/)
  })

  it('keeps the team role and permissions on a dashboard session', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))

    const auth = await requireAuth()
    expect(auth.principal.role).toBe('admin')
    expect(auth.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE)
  })
})

// The mint decision and the gate, end to end: the scope assignSessionScope
// stamps on a fresh anonymous session is the scope requireAuth then reads.
describe('anonymous sessions minted by each surface', () => {
  async function mintedAnonymousSession(headers: Record<string, string>) {
    const minted = await assignSessionScope(
      { userId: 'user_anon', token: 'tok' },
      { path: '/sign-in/anonymous', headers: new Headers(headers) }
    )
    return {
      session: { id: 'sess_anon', scope: minted?.data.scope },
      user: { id: 'user_anon', email: 'temp-x@anon.invalid', name: 'Anon', image: null },
    }
  }

  beforeEach(() => {
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_anon',
      role: 'user',
      type: 'anonymous',
    })
  })

  it('lets a portal anonymous session through requireAuth as an anonymous portal user', async () => {
    mockGetSession.mockResolvedValue(
      await mintedAnonymousSession({ [SESSION_AUDIENCE_HEADER]: 'portal' })
    )

    const auth = await requireAuth()
    expect(auth.scope).toBe('portal')
    expect(auth.principal).toEqual({ id: 'principal_anon', role: 'user', type: 'anonymous' })
    expect(auth.permissions).toEqual([])
  })

  it('still refuses a widget anonymous session at requireAuth', async () => {
    mockGetSession.mockResolvedValue(await mintedAnonymousSession({}))

    await expect(requireAuth()).rejects.toThrow(/Widget sessions cannot access this resource/)
  })

  it('refuses a portal anonymous session at a permission gate', async () => {
    mockGetSession.mockResolvedValue(
      await mintedAnonymousSession({ [SESSION_AUDIENCE_HEADER]: 'portal' })
    )

    await expect(requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })).rejects.toThrow(
      /dashboard session/
    )
  })
})

describe('getOptionalAuth strips team authority from non-dashboard scopes', () => {
  it('treats a widget session as anonymous by default', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('widget'))

    expect(await getOptionalAuth()).toBeNull()
  })

  it('downgrades a promoted portal principal to the portal tier', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('portal'))

    const auth = await getOptionalAuth()
    expect(auth?.scope).toBe('portal')
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

describe('assertDashboardScope', () => {
  it('rejects widget and portal', () => {
    expect(() => assertDashboardScope({ scope: 'widget' })).toThrow(/dashboard session/)
    expect(() => assertDashboardScope({ scope: 'portal' })).toThrow(/dashboard session/)
  })

  it('allows dashboard', () => {
    expect(() => assertDashboardScope({ scope: 'dashboard' })).not.toThrow()
  })
})

describe('sessionRole', () => {
  it('keeps the role only for dashboard sessions', () => {
    expect(sessionRole('admin', 'dashboard')).toBe('admin')
    expect(sessionRole('member', 'dashboard')).toBe('member')
    expect(sessionRole('admin', 'widget')).toBe('user')
    expect(sessionRole('member', 'portal')).toBe('user')
  })
})
