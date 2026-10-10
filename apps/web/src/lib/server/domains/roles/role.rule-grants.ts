/**
 * Role rules that grant a workspace role are grants. Everyone who matches the
 * rule will hold that role, so saving one is held to the ceiling a direct role
 * change has: the role exists, is not the Owner preset, and its bundle sits
 * within the saver's own permissions.
 *
 * Any change to the role section re-grants every role its rules give, since
 * reordering, repointing the claim or turning sync on changes who gets what.
 * The one exception is an unchanged rule whose role has since been deleted: it
 * grants nothing at sign-in, so it must not block the edit.
 */
import { db, eq, inArray, permissions, rolePermissions } from '@/lib/server/db'
import type { RoleId } from '@quackback/ids'
import type { PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  adminTierRoleIds,
  roleRuleGrantsToCheck,
  roleRuleRoleIds,
  type RoleRuleGrantCheck,
} from '@/lib/shared/sso-claim-mapping-edit'
import { assertGrantableRole } from './role.grants'

/**
 * Check the grants a mapping save makes, then report which of the roles its
 * rules name reach the admin tier, for `mappingSaveRisks`.
 *
 * @throws ForbiddenError when the saver's permissions are missing, or a new
 *   rule names the Owner preset or a bundle above them
 * @throws ValidationError when a new rule names a role that does not exist
 */
export async function checkRoleRuleGrants(
  before: unknown,
  after: unknown,
  granter: readonly PermissionKey[] | undefined
): Promise<{ adminTierRoleIds: Set<string> }> {
  const granted = roleRuleGrantsToCheck(before, after)
  if (granted.length > 0) {
    const added = new Set(roleRuleRoleIds(after, { newSince: before }))
    // Fail closed: a caller that did not pass its own resolved set cannot grant.
    if (!granter) {
      throw new ForbiddenError('GRANT_CEILING', 'Assigner permission set is required')
    }
    for (const roleId of granted) {
      try {
        await assertGrantableRole(roleId as RoleId, granter)
      } catch (error) {
        if (error instanceof NotFoundError) {
          if (!added.has(roleId)) continue
          throw new ValidationError(
            'ROLE_RULE_UNKNOWN_ROLE',
            'A role rule names a role that no longer exists. Pick another role.'
          )
        }
        throw error
      }
    }
  }

  const named = roleRuleRoleIds(after)
  if (named.length === 0) return { adminTierRoleIds: new Set() }
  const rows = await db
    .select({ roleId: rolePermissions.roleId, key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(rolePermissions.roleId, named as RoleId[]))
  const keysByRole = new Map<string, string[]>()
  for (const row of rows) {
    const list = keysByRole.get(row.roleId) ?? []
    list.push(row.key)
    keysByRole.set(row.roleId, list)
  }
  return {
    adminTierRoleIds: adminTierRoleIds(
      [...keysByRole].map(([id, permissionKeys]) => ({ id, permissionKeys }))
    ),
  }
}

/** The grant check for one saving admin, for the identity-provider saves. */
export function roleRuleGrantCheck(granter: readonly PermissionKey[]): RoleRuleGrantCheck {
  return (before, after) => checkRoleRuleGrants(before, after, granter)
}
