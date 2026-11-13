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
import {
  db,
  principal,
  principalRoleAssignments,
  roles,
  and,
  eq,
  inArray,
  isNull,
} from '@/lib/server/db'
import { ForbiddenError } from '@/lib/shared/errors'
import { SYSTEM_ROLES, presetForLegacyRole } from '@/lib/shared/permissions'
import { setPrincipalRole, type Executor } from '@/lib/server/domains/principals/principal.factory'
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
  grantedBy: PrincipalId,
  executor?: Executor
): Promise<void> {
  await setPrincipalRole({ principalId: keyPrincipalId }, role.legacyRole, {
    assignRoleId: role.assignRoleId,
    assignGrantedBy: grantedBy,
    resetAssignment: role.assignRoleId === undefined,
    executor,
  })
}

type RoleRef = { id: RoleId; name: string }

/** The role each workspace key holds now: its explicit assignment, else its legacy tier's preset. */
export async function currentWorkspaceKeyRoles(
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

/**
 * Refuse to rotate, rename or re-role a workspace key whose current role
 * `granter` could not grant: a fresh secret for it would hand them authority
 * above their own. Revoking needs no such check.
 */
export async function assertCanManageWorkspaceKey(
  keyPrincipalId: PrincipalId,
  granter: ApiKeyGranter
): Promise<void> {
  const current = (await currentWorkspaceKeyRoles([keyPrincipalId])).get(keyPrincipalId)
  if (!current) {
    throw new ForbiddenError('GRANT_CEILING', 'This key has no role you can manage')
  }
  await resolveGrantableKeyRole(current.id, granter)
}
