import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { permissionsForLegacyRole, permissionsForPrincipal } from '../permissions'
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  presetForLegacyRole,
  PERMISSIONS,
} from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'

const dbMock = vi.hoisted(() => {
  const rows: Array<{ assignmentId: string; key: string | null }> = []
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  query.from = vi.fn(() => query)
  query.leftJoin = vi.fn(() => query)
  query.where = vi.fn(async () => rows)
  return { rows, select: vi.fn(() => query) }
})

vi.mock('@/lib/server/db', () => ({
  db: { select: dbMock.select },
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  permissions: { id: 'permissions.id', key: 'permissions.key' },
  principalRoleAssignments: {
    id: 'principalRoleAssignments.id',
    principalId: 'principalRoleAssignments.principalId',
    roleId: 'principalRoleAssignments.roleId',
    teamId: 'principalRoleAssignments.teamId',
  },
  rolePermissions: {
    permissionId: 'rolePermissions.permissionId',
    roleId: 'rolePermissions.roleId',
  },
}))

const ROLES: Role[] = ['admin', 'member', 'user']

beforeEach(() => {
  dbMock.rows.length = 0
  dbMock.select.mockClear()
})

// The compat shim's correctness proof: requireAuth({ permission: P }) checks
// permissionsForLegacyRole(role).has(P), so if the expansion equals the role's
// preset bundle, the permission gate is provably equivalent to the legacy role
// gate for every (role, permission) pair.
describe('permissionsForLegacyRole (compat shim)', () => {
  it('expands each legacy role to its preset bundle', () => {
    for (const role of ROLES) {
      const preset = presetForLegacyRole(role)
      const expected = new Set(preset ? SYSTEM_ROLE_PERMISSIONS[preset] : [])
      expect(permissionsForLegacyRole(role)).toEqual(expected)
    }
  })

  it('user (the People axis) resolves to zero permissions', () => {
    expect(permissionsForLegacyRole('user').size).toBe(0)
  })

  it('{ permission } is equivalent to the role bundle for every (role, permission) pair', () => {
    for (const role of ROLES) {
      const preset = presetForLegacyRole(role)
      const bundle = new Set<string>(preset ? SYSTEM_ROLE_PERMISSIONS[preset] : [])
      const resolved = permissionsForLegacyRole(role)
      for (const p of ALL_PERMISSIONS) {
        expect(resolved.has(p)).toBe(bundle.has(p))
      }
    }
  })

  it('admin (Owner) holds billing + settings; member (Manager) holds neither but operates', () => {
    const admin = permissionsForLegacyRole('admin')
    expect(admin.has(PERMISSIONS.BILLING_MANAGE)).toBe(true)
    expect(admin.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(true)

    const member = permissionsForLegacyRole('member')
    expect(member.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
    expect(member.has(PERMISSIONS.MEMBER_MANAGE)).toBe(false)
    expect(member.has(PERMISSIONS.BILLING_MANAGE)).toBe(false)
    // ...but keeps the operate + non-regressing read permissions.
    expect(member.has(PERMISSIONS.POST_EDIT)).toBe(true)
    expect(member.has(PERMISSIONS.MEMBER_VIEW)).toBe(true)
    expect(member.has(PERMISSIONS.INTEGRATION_VIEW)).toBe(true)
  })
})

describe('permissionsForPrincipal', () => {
  it('falls back to the legacy bundle only when no workspace assignment exists', async () => {
    const resolved = await permissionsForPrincipal('principal_1' as PrincipalId, 'member')

    expect(resolved).toEqual(permissionsForLegacyRole('member'))
  })

  it('returns an assigned custom role permission set', async () => {
    dbMock.rows.push(
      { assignmentId: 'assignment_1', key: PERMISSIONS.BILLING_MANAGE },
      { assignmentId: 'assignment_1', key: PERMISSIONS.CONVERSATION_VIEW }
    )

    const resolved = await permissionsForPrincipal('principal_1' as PrincipalId, 'user')

    expect(resolved).toEqual(new Set([PERMISSIONS.BILLING_MANAGE, PERMISSIONS.CONVERSATION_VIEW]))
  })

  it('keeps an assigned zero-permission role empty instead of using the legacy fallback', async () => {
    dbMock.rows.push({ assignmentId: 'assignment_1', key: null })

    const resolved = await permissionsForPrincipal('principal_1' as PrincipalId, 'admin')

    expect(resolved.size).toBe(0)
  })
})
