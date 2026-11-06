/**
 * What the key managers see: every live key with its creator and, for a
 * workspace key, its role; and the roles a workspace key may be given.
 */
import type { PrincipalId } from '@quackback/ids'
import { db, principal, user, eq, inArray } from '@/lib/server/db'
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'
import { isAdmin, isTeamMember } from '@/lib/shared/roles'
import { listApiKeys } from './api-key.service'
import { currentWorkspaceKeyRoles } from './workspace-key-role'
import type { ApiKeyGranter, ManagedApiKey, WorkspaceKeyRoleOption } from './api-key.types'

/**
 * Every live key, newest first, with its creator and (for a workspace key) its
 * role, marked with whether `viewer` may rotate, rename or re-role it: only
 * when they could grant the role it holds now.
 */
export async function listManagedApiKeys(viewer: ApiKeyGranter): Promise<ManagedApiKey[]> {
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
    currentWorkspaceKeyRoles(keys.filter((k) => k.kind === 'workspace').map((k) => k.principalId)),
  ])
  const grantable = keys.some((k) => k.kind === 'workspace')
    ? new Set(
        (await listWorkspaceKeyRoleOptions(viewer)).filter((o) => o.grantable).map((o) => o.id)
      )
    : new Set()
  const creatorById = new Map(creators.map((c) => [c.id as PrincipalId, c]))
  return keys.map((key) => {
    const creator = key.createdById ? creatorById.get(key.createdById) : undefined
    const role = key.kind === 'workspace' ? (keyRoles.get(key.principalId) ?? null) : null
    return {
      ...key,
      creatorName: creator ? (creator.displayName ?? creator.userName ?? null) : null,
      creatorIsTeammate: creator ? isTeamMember(creator.role) : false,
      role,
      manageable: key.kind === 'workspace' && !!role && grantable.has(role.id),
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
