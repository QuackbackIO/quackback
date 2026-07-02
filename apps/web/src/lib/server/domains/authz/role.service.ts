/**
 * Role service — CRUD for role bundles + permission assignments + grants.
 *
 * System roles (`isSystem=true`) are seeded by migration and are read-only
 * from the UI: they cannot be renamed, have their permissions changed, or be
 * deleted. They CAN be granted/revoked freely.
 *
 * All write paths emit an audit event via `recordEvent`.
 */
import {
  db,
  eq,
  and,
  inArray,
  count,
  desc,
  roles,
  permissions as permissionsTable,
  rolePermissions,
  principalRoleAssignments,
  teams,
} from '@/lib/server/db'
import type { PermissionId, PrincipalId, RoleId, RoleAssignmentId, TeamId } from '@quackback/ids'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { recordEvent } from '@/lib/server/domains/audit/audit.service'
import {
  dispatchRoleCreated,
  dispatchRoleUpdated,
  dispatchRoleDeleted,
  dispatchRoleAssignmentCreated,
  dispatchRoleAssignmentRevoked,
} from '@/lib/server/events/dispatch'
import { ALL_PERMISSIONS, type PermissionKey } from './authz.permissions'

const ROLE_ACTOR = { type: 'service' as const, displayName: 'authz-system' }

export interface RoleListItem {
  id: RoleId
  key: string
  name: string
  description: string | null
  isSystem: boolean
  permissionCount: number
  assignmentCount: number
}

export interface RoleWithPermissions {
  id: RoleId
  key: string
  name: string
  description: string | null
  isSystem: boolean
  permissionKeys: PermissionKey[]
  createdAt: Date
  updatedAt: Date
}

export interface PrincipalRoleAssignmentRow {
  id: RoleAssignmentId
  role: { id: RoleId; key: string; name: string; isSystem: boolean }
  teamId: TeamId | null
  teamName: string | null
  grantedByPrincipalId: PrincipalId | null
  createdAt: Date
}

export async function listRoles(): Promise<RoleListItem[]> {
  const rows = await db.select().from(roles).orderBy(desc(roles.isSystem), roles.name)
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const permCounts = await db
    .select({ roleId: rolePermissions.roleId, n: count(rolePermissions.id) })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, ids))
    .groupBy(rolePermissions.roleId)
  const asgnCounts = await db
    .select({ roleId: principalRoleAssignments.roleId, n: count(principalRoleAssignments.id) })
    .from(principalRoleAssignments)
    .where(inArray(principalRoleAssignments.roleId, ids))
    .groupBy(principalRoleAssignments.roleId)

  const permMap = new Map(permCounts.map((r) => [r.roleId, Number(r.n)]))
  const asgnMap = new Map(asgnCounts.map((r) => [r.roleId, Number(r.n)]))

  return rows.map((r) => ({
    id: r.id as RoleId,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissionCount: permMap.get(r.id) ?? 0,
    assignmentCount: asgnMap.get(r.id) ?? 0,
  }))
}

export async function getRoleWithPermissions(roleId: RoleId): Promise<RoleWithPermissions> {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1)
  if (!role) throw new NotFoundError('ROLE_NOT_FOUND', 'Role not found')

  const grants = await db
    .select({ key: permissionsTable.key })
    .from(rolePermissions)
    .innerJoin(permissionsTable, eq(rolePermissions.permissionId, permissionsTable.id))
    .where(eq(rolePermissions.roleId, roleId))

  return {
    id: role.id as RoleId,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionKeys: grants.map((g) => g.key as PermissionKey),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }
}

interface CreateRoleInput {
  key: string
  name: string
  description?: string | null
  permissionKeys: PermissionKey[]
  actorPrincipalId: PrincipalId
}

export async function createRole(input: CreateRoleInput): Promise<RoleId> {
  validatePermissionKeys(input.permissionKeys)

  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, input.key))
    .limit(1)
  if (existing) throw new ConflictError('ROLE_KEY_EXISTS', 'Role key already exists')

  const newId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(roles)
      .values({
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
      })
      .returning({ id: roles.id })
    if (!inserted) throw new Error('Failed to insert role')

    if (input.permissionKeys.length > 0) {
      const permIds = await loadPermissionIdsTx(tx, input.permissionKeys)
      await tx.insert(rolePermissions).values(
        permIds.map((permissionId) => ({
          roleId: inserted.id as RoleId,
          permissionId,
        }))
      )
    }
    return inserted.id as RoleId
  })

  await recordEvent({
    principalId: input.actorPrincipalId,
    action: 'role.created',
    targetType: 'role',
    targetId: newId,
    diff: {
      after: {
        key: input.key,
        name: input.name,
        permissions: input.permissionKeys,
      },
    },
  })

  void dispatchRoleCreated(ROLE_ACTOR, {
    id: newId,
    key: input.key,
    name: input.name,
    isSystem: false,
  }).catch(() => {})

  return newId
}

interface UpdateRoleInput {
  id: RoleId
  name: string
  description?: string | null
  actorPrincipalId: PrincipalId
}

export async function updateRole(input: UpdateRoleInput): Promise<void> {
  const [role] = await db.select().from(roles).where(eq(roles.id, input.id)).limit(1)
  if (!role) throw new NotFoundError('ROLE_NOT_FOUND', 'Role not found')
  if (role.isSystem) throw new ForbiddenError('ROLE_SYSTEM', 'System roles cannot be edited')

  await db
    .update(roles)
    .set({ name: input.name, description: input.description ?? null })
    .where(eq(roles.id, input.id))

  await recordEvent({
    principalId: input.actorPrincipalId,
    action: 'role.updated',
    targetType: 'role',
    targetId: input.id,
    diff: {
      before: { name: role.name, description: role.description },
      after: { name: input.name, description: input.description ?? null },
    },
  })

  const changedFields = ['name']
  if (input.description !== undefined) changedFields.push('description')
  void dispatchRoleUpdated(
    ROLE_ACTOR,
    {
      id: role.id as RoleId,
      key: role.key,
      name: input.name,
      isSystem: role.isSystem,
    },
    changedFields
  ).catch(() => {})
}

export async function deleteRole(input: {
  id: RoleId
  actorPrincipalId: PrincipalId
}): Promise<void> {
  const [role] = await db.select().from(roles).where(eq(roles.id, input.id)).limit(1)
  if (!role) throw new NotFoundError('ROLE_NOT_FOUND', 'Role not found')
  if (role.isSystem) throw new ForbiddenError('ROLE_SYSTEM', 'System roles cannot be deleted')

  const [{ n }] = await db
    .select({ n: count(principalRoleAssignments.id) })
    .from(principalRoleAssignments)
    .where(eq(principalRoleAssignments.roleId, input.id))
  if (Number(n) > 0) {
    throw new ConflictError(
      'ROLE_HAS_ASSIGNMENTS',
      'Revoke all assignments before deleting this role'
    )
  }

  await db.delete(roles).where(eq(roles.id, input.id))

  await recordEvent({
    principalId: input.actorPrincipalId,
    action: 'role.deleted',
    targetType: 'role',
    targetId: input.id,
    diff: { before: { key: role.key, name: role.name } },
  })

  void dispatchRoleDeleted(ROLE_ACTOR, {
    id: role.id as RoleId,
    key: role.key,
    name: role.name,
    isSystem: role.isSystem,
  }).catch(() => {})
}

interface SetRolePermissionsInput {
  roleId: RoleId
  permissionKeys: PermissionKey[]
  actorPrincipalId: PrincipalId
}

export async function setRolePermissions(input: SetRolePermissionsInput): Promise<void> {
  validatePermissionKeys(input.permissionKeys)

  const [role] = await db.select().from(roles).where(eq(roles.id, input.roleId)).limit(1)
  if (!role) throw new NotFoundError('ROLE_NOT_FOUND', 'Role not found')
  if (role.isSystem)
    throw new ForbiddenError('ROLE_SYSTEM', 'System role permissions cannot be changed')

  const existing = await db
    .select({ key: permissionsTable.key })
    .from(rolePermissions)
    .innerJoin(permissionsTable, eq(rolePermissions.permissionId, permissionsTable.id))
    .where(eq(rolePermissions.roleId, input.roleId))
  const before = existing.map((g) => g.key as PermissionKey)

  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, input.roleId))
    if (input.permissionKeys.length > 0) {
      const permIds = await loadPermissionIdsTx(tx, input.permissionKeys)
      await tx
        .insert(rolePermissions)
        .values(permIds.map((permissionId) => ({ roleId: input.roleId, permissionId })))
    }
  })

  await recordEvent({
    principalId: input.actorPrincipalId,
    action: 'role.permissions_set',
    targetType: 'role',
    targetId: input.roleId,
    diff: {
      before: { permissions: before },
      after: { permissions: input.permissionKeys },
    },
  })
}

export async function listAssignmentsForPrincipal(
  principalId: PrincipalId
): Promise<PrincipalRoleAssignmentRow[]> {
  const rows = await db
    .select({
      id: principalRoleAssignments.id,
      teamId: principalRoleAssignments.teamId,
      grantedByPrincipalId: principalRoleAssignments.grantedByPrincipalId,
      createdAt: principalRoleAssignments.createdAt,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      roleIsSystem: roles.isSystem,
      teamName: teams.name,
    })
    .from(principalRoleAssignments)
    .innerJoin(roles, eq(principalRoleAssignments.roleId, roles.id))
    .leftJoin(teams, eq(principalRoleAssignments.teamId, teams.id))
    .where(eq(principalRoleAssignments.principalId, principalId))
    .orderBy(desc(principalRoleAssignments.createdAt))

  return rows.map((r) => ({
    id: r.id as RoleAssignmentId,
    role: {
      id: r.roleId as RoleId,
      key: r.roleKey,
      name: r.roleName,
      isSystem: r.roleIsSystem,
    },
    teamId: (r.teamId as TeamId | null) ?? null,
    teamName: r.teamName ?? null,
    grantedByPrincipalId: (r.grantedByPrincipalId as PrincipalId | null) ?? null,
    createdAt: r.createdAt,
  }))
}

interface AssignRoleInput {
  principalId: PrincipalId
  roleId: RoleId
  teamId?: TeamId | null
  actorPrincipalId: PrincipalId
}

export async function assignRole(input: AssignRoleInput): Promise<RoleAssignmentId> {
  const [role] = await db.select().from(roles).where(eq(roles.id, input.roleId)).limit(1)
  if (!role) throw new NotFoundError('ROLE_NOT_FOUND', 'Role not found')

  const teamId = input.teamId ?? null
  const dupeWhere = teamId
    ? and(
        eq(principalRoleAssignments.principalId, input.principalId),
        eq(principalRoleAssignments.roleId, input.roleId),
        eq(principalRoleAssignments.teamId, teamId)
      )
    : and(
        eq(principalRoleAssignments.principalId, input.principalId),
        eq(principalRoleAssignments.roleId, input.roleId)
      )
  const [existing] = await db
    .select({ id: principalRoleAssignments.id })
    .from(principalRoleAssignments)
    .where(dupeWhere)
    .limit(1)
  if (existing)
    throw new ConflictError('ROLE_ALREADY_ASSIGNED', 'Role already assigned for this scope')

  const [inserted] = await db
    .insert(principalRoleAssignments)
    .values({
      principalId: input.principalId,
      roleId: input.roleId,
      teamId,
      grantedByPrincipalId: input.actorPrincipalId,
    })
    .returning({ id: principalRoleAssignments.id })
  if (!inserted) throw new Error('Failed to insert role assignment')

  await recordEvent({
    principalId: input.actorPrincipalId,
    action: 'role_assignment.granted',
    targetType: 'principal',
    targetId: input.principalId,
    diff: {
      after: { role: role.key, teamId },
    },
  })

  void dispatchRoleAssignmentCreated(ROLE_ACTOR, {
    id: inserted.id as RoleAssignmentId,
    roleId: input.roleId,
    roleKey: role.key,
    principalId: input.principalId,
    teamId,
  }).catch(() => {})

  return inserted.id as RoleAssignmentId
}

export async function revokeRoleAssignment(input: {
  assignmentId: RoleAssignmentId
  actorPrincipalId: PrincipalId
}): Promise<void> {
  const [row] = await db
    .select({
      principalId: principalRoleAssignments.principalId,
      roleId: principalRoleAssignments.roleId,
      teamId: principalRoleAssignments.teamId,
      roleKey: roles.key,
    })
    .from(principalRoleAssignments)
    .innerJoin(roles, eq(principalRoleAssignments.roleId, roles.id))
    .where(eq(principalRoleAssignments.id, input.assignmentId))
    .limit(1)
  if (!row) throw new NotFoundError('ASSIGNMENT_NOT_FOUND', 'Role assignment not found')

  await db
    .delete(principalRoleAssignments)
    .where(eq(principalRoleAssignments.id, input.assignmentId))

  await recordEvent({
    principalId: input.actorPrincipalId,
    action: 'role_assignment.revoked',
    targetType: 'principal',
    targetId: row.principalId as string,
    diff: {
      before: { role: row.roleKey, teamId: row.teamId },
    },
  })

  void dispatchRoleAssignmentRevoked(ROLE_ACTOR, {
    id: input.assignmentId,
    roleId: row.roleId as RoleId,
    roleKey: row.roleKey,
    principalId: row.principalId as PrincipalId,
    teamId: (row.teamId as TeamId | null) ?? null,
  }).catch(() => {})
}

// --- helpers --------------------------------------------------------------

function validatePermissionKeys(keys: PermissionKey[]) {
  const valid = new Set<string>(ALL_PERMISSIONS)
  for (const k of keys) {
    if (!valid.has(k)) throw new ConflictError('UNKNOWN_PERMISSION', `Unknown permission: ${k}`)
  }
}

async function loadPermissionIdsTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  keys: PermissionKey[]
): Promise<PermissionId[]> {
  const rows = await tx
    .select({ id: permissionsTable.id, key: permissionsTable.key })
    .from(permissionsTable)
    .where(inArray(permissionsTable.key, keys as string[]))
  if (rows.length !== keys.length) {
    const found = new Set(rows.map((r) => r.key))
    const missing = keys.filter((k) => !found.has(k))
    throw new ConflictError(
      'PERMISSIONS_MISSING',
      `Permissions missing from DB (run migrations?): ${missing.join(', ')}`
    )
  }
  return rows.map((r) => r.id as PermissionId)
}
