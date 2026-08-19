/**
 * The assignment-grant ceiling, shared by every surface that writes a role
 * assignment (updateMemberRole, the invite send path, and through them the
 * REST PATCH). Kept beside the role service but in its own module so the
 * service stays within size bounds.
 */
import { db } from '@/lib/server/db'
import type { RoleId } from '@quackback/ids'
import { SYSTEM_ROLES, type PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError } from '@/lib/shared/errors'
import { assertWithinCeiling } from './role.ceiling'
import { loadRole, permissionKeysForRole } from './role.service'

/**
 * Validate that `roleId` may be granted by an assigner holding `granter`:
 * the role exists, is not the Owner preset (that tier rides the legacy
 * 'admin' role and its promotion path), and its bundle is within the
 * assigner's own permission set. Assignment IS a grant — the same ceiling as
 * authoring applies, or member.manage becomes a path to hand out bundles the
 * assigner doesn't hold.
 */
export async function assertGrantableRole(
  roleId: RoleId,
  granter: readonly PermissionKey[]
): Promise<{ id: RoleId; key: string; name: string }> {
  const role = await loadRole(roleId)
  if (role.key === SYSTEM_ROLES.OWNER) {
    throw new ForbiddenError('FORBIDDEN', 'Grant Owner by promoting to admin instead')
  }
  const targetKeys = await permissionKeysForRole(db, role.id)
  assertWithinCeiling(
    [...targetKeys],
    new Set(granter),
    "You can't grant a role with permissions you don't hold"
  )
  return { id: role.id, key: role.key, name: role.name }
}
