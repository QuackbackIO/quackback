/**
 * What the key managers see: every live key with its creator and, for a
 * workspace key, its role; and the roles a workspace key may be given.
 */
import type { PrincipalId, RoleId } from '@quackback/ids'
import {
  db,
  principal,
  principalRoleAssignments,
  roles,
  user,
  and,
  eq,
  inArray,
  isNull,
} from '@/lib/server/db'
import { PERMISSIONS, SYSTEM_ROLES, presetForLegacyRole } from '@/lib/shared/permissions'
import { isAdmin, isTeamMember } from '@/lib/shared/roles'
import { listApiKeys } from './api-key.service'
import type { ApiKeyGranter, ManagedApiKey, WorkspaceKeyRoleOption } from './api-key.types'

type RoleRef = { id: RoleId; name: string }

/** Whose roles give a workspace key its authority: an explicit assignment, else its legacy tier's preset. */
async function workspaceKeyRoles(
  keyPrincipalIds: PrincipalId[]
): Promise<Map<PrincipalId, RoleRef>> {
  const result = new Map<PrincipalId, RoleRef>()
  if (keyPrincipalIds.length === 0) return result
  const [assigned, tiers, presets] = await Promise.all([
    db
      .select({
        principalId: principalRoleAssignments.principalId,
        id: roles.id,
        name: roles.name,
      })
      .from(principalRoleAssignments)
      .innerJoin(roles, eq(roles.id, principalRoleAssignments.roleId))
      .where(
        and(
          inArray(principalRoleAssignments.principalId, keyPrincipalIds),
          isNull(principalRoleAssignments.teamId)
        )
      ),
    db
      .select({ id: principal.id, role: principal.role })
      .from(principal)
      .where(inArray(principal.id, keyPrincipalIds)),
    db
      .select({ id: roles.id, key: roles.key, name: roles.name })
      .from(roles)
      .where(inArray(roles.key, [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.MANAGER])),
  ])
  const presetByKey = new Map(presets.map((r) => [r.key, { id: r.id as RoleId, name: r.name }]))
  for (const tier of tiers) {
    const preset = presetForLegacyRole(tier.role)
    const ref = preset ? presetByKey.get(preset) : undefined
    if (ref) result.set(tier.id as PrincipalId, ref)
  }
  for (const row of assigned) {
    result.set(row.principalId as PrincipalId, { id: row.id as RoleId, name: row.name })
  }
  return result
}

/** Every live key, newest first, with its creator and (for a workspace key) its role. */
export async function listManagedApiKeys(): Promise<ManagedApiKey[]> {
  const keys = await listApiKeys()
  const creatorIds = [
    ...new Set(keys.map((k) => k.createdById).filter((id): id is PrincipalId => !!id)),
  ]
  const [creators, keyRoles] = await Promise.all([
    creatorIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: principal.id,
            role: principal.role,
            displayName: principal.displayName,
            userName: user.name,
          })
          .from(principal)
          .leftJoin(user, eq(user.id, principal.userId))
          .where(inArray(principal.id, creatorIds)),
    workspaceKeyRoles(keys.filter((k) => k.kind === 'workspace').map((k) => k.principalId)),
  ])
  const creatorById = new Map(creators.map((c) => [c.id as PrincipalId, c]))
  return keys.map((key) => {
    const creator = key.createdById ? creatorById.get(key.createdById) : undefined
    return {
      ...key,
      creatorName: creator ? (creator.displayName ?? creator.userName ?? null) : null,
      creatorIsTeammate: creator ? isTeamMember(creator.role) : false,
      role: key.kind === 'workspace' ? (keyRoles.get(key.principalId) ?? null) : null,
    }
  })
}

/** Permissions that let a key change workspace settings or members. */
const HIGH_IMPACT_PERMISSIONS = [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.MEMBER_MANAGE]

/**
 * Every role, in the roles list order, marked with whether `granter` may give
 * it to a workspace key. The same two limits as creating one: the role's
 * permissions must all be the granter's own, and only an admin grants Owner.
 */
export async function listWorkspaceKeyRoleOptions(
  granter: ApiKeyGranter
): Promise<WorkspaceKeyRoleOption[]> {
  const { listRoles } = await import('@/lib/server/domains/roles/role.service')
  const held = new Set(granter.permissions)
  return (await listRoles()).map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    isSystem: role.isSystem,
    grantable:
      role.isSystem && role.key === SYSTEM_ROLES.OWNER
        ? isAdmin(granter.role)
        : role.permissionKeys.every((key) => held.has(key)),
    highImpact: HIGH_IMPACT_PERMISSIONS.some((key) => role.permissionKeys.includes(key)),
  }))
}
