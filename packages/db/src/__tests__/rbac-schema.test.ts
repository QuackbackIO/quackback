import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { roles, permissions, rolePermissions, principalRoleAssignments } from '../schema/rbac'

describe('RBAC schema', () => {
  it('table names', () => {
    expect(getTableName(roles)).toBe('roles')
    expect(getTableName(permissions)).toBe('permissions')
    expect(getTableName(rolePermissions)).toBe('role_permissions')
    expect(getTableName(principalRoleAssignments)).toBe('principal_role_assignments')
  })

  it('roles columns', () => {
    const cols = Object.keys(getTableColumns(roles))
    expect(cols.sort()).toEqual(
      ['id', 'key', 'name', 'description', 'isSystem', 'createdAt', 'updatedAt'].sort()
    )
  })

  it('permissions columns', () => {
    const cols = Object.keys(getTableColumns(permissions))
    expect(cols.sort()).toEqual(
      ['id', 'key', 'category', 'description', 'isSystem', 'createdAt'].sort()
    )
  })

  it('role_permissions columns', () => {
    const cols = Object.keys(getTableColumns(rolePermissions))
    expect(cols.sort()).toEqual(['id', 'roleId', 'permissionId'].sort())
  })

  it('principal_role_assignments columns', () => {
    const cols = Object.keys(getTableColumns(principalRoleAssignments))
    expect(cols.sort()).toEqual(
      ['id', 'principalId', 'roleId', 'teamId', 'grantedByPrincipalId', 'createdAt'].sort()
    )
  })

  it('0126 migration pins the partial unique index and FK cascades', () => {
    const sql = readFileSync(
      join(__dirname, '../../drizzle/0126_rbac_roles_permissions.sql'),
      'utf8'
    )
    // The backfill's idempotency backstop: one workspace-wide assignment per
    // (principal, role), exempting future team-scoped grants.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "principal_role_assignments_workspace_unique_idx"[\s\S]*?WHERE team_id IS NULL/
    )
    // Cascades so deleting a principal/role tears down its assignments + grants.
    expect(sql).toContain('principal_role_assignments_principal_id_principal_id_fk')
    expect(sql).toMatch(/role_permissions_role_id_roles_id_fk[\s\S]*?ON DELETE cascade/)
    expect(sql).toMatch(/granted_by_principal_id[\s\S]*?ON DELETE set null/)
    // Unique keys for upsert-by-key in the seed.
    expect(sql).toContain('"roles_key_unique" UNIQUE("key")')
    expect(sql).toContain('"permissions_key_unique" UNIQUE("key")')
  })
})
