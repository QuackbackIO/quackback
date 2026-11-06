/**
 * The role a workspace API key holds, and the ceiling on granting it.
 *
 * A workspace key belongs to nobody: its authority is its own workspace role,
 * written as a role assignment on the key's service principal exactly as a
 * teammate's role is, through `setPrincipalRole`. Granting it is a grant like
 * any other, so the same two limits apply as when re-roling a teammate: the
 * role's bundle must sit within the granter's own permissions, and the Owner
 * tier (legacy `admin`) is granted only by an admin. The Owner and Manager
 * presets ride their legacy role with no explicit assignment, so the seed heal
 * keeps owning those rows.
 */
import type { PrincipalId, RoleId } from '@quackback/ids'
import { SYSTEM_ROLES } from '@/lib/shared/permissions'
import { setPrincipalRole } from '@/lib/server/domains/principals/principal.factory'
import type { ApiKeyGranter } from './api-key.types'

export interface WorkspaceKeyRole {
  legacyRole: 'admin' | 'member'
  /** The explicit assignment to write; absent for the Owner and Manager presets. */
  assignRoleId?: RoleId
  roleName: string
}

/** Check that `granter` may give a key `roleId`, and resolve how the role is stored. */
export async function resolveGrantableKeyRole(
  roleId: RoleId,
  granter: ApiKeyGranter
): Promise<WorkspaceKeyRole> {
  const { loadRole } = await import('@/lib/server/domains/roles/role.service')
  const { assertCanGrantTeamRole, assertGrantableRole } =
    await import('@/lib/server/domains/roles/role.grants')
  const role = await loadRole(roleId)
  if (role.key === SYSTEM_ROLES.OWNER) {
    assertCanGrantTeamRole('admin', granter.role)
    return { legacyRole: 'admin', roleName: role.name }
  }
  const target = await assertGrantableRole(role.id, granter.permissions)
  if (role.key === SYSTEM_ROLES.MANAGER) return { legacyRole: 'member', roleName: target.name }
  return { legacyRole: 'member', assignRoleId: target.id, roleName: target.name }
}

/** Write a resolved role onto a workspace key's service principal. */
export async function applyWorkspaceKeyRole(
  keyPrincipalId: PrincipalId,
  role: WorkspaceKeyRole,
  grantedBy: PrincipalId
): Promise<void> {
  await setPrincipalRole({ principalId: keyPrincipalId }, role.legacyRole, {
    assignRoleId: role.assignRoleId,
    assignGrantedBy: grantedBy,
    resetAssignment: role.assignRoleId === undefined,
  })
}
