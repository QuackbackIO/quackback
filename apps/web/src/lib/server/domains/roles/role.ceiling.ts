/**
 * Pure ceiling checks shared by role authoring (create/update) and role
 * granting (assignment/reassign). No DB access, so both role.service and
 * role.grants can import it without a cycle.
 */
import { ALL_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

/** Reject any key not in the catalogue. */
export function assertKnownPermissions(keys: readonly PermissionKey[]): void {
  const catalogue = new Set<string>(ALL_PERMISSIONS)
  const unknown = keys.filter((k) => !catalogue.has(k))
  if (unknown.length > 0) {
    throw new ValidationError('VALIDATION_ERROR', `Unknown permissions: ${unknown.join(', ')}`)
  }
}

/**
 * Reject any of `keys` the actor doesn't hold. `message` tailors the error to
 * the surface (authoring a role vs. reassigning holders to one).
 */
export function assertWithinCeiling(
  keys: readonly PermissionKey[],
  held: ReadonlySet<PermissionKey>,
  message = "You can't grant permissions you don't hold"
): void {
  const aboveCeiling = keys.filter((k) => !held.has(k))
  if (aboveCeiling.length > 0) {
    throw new ForbiddenError(
      'GRANT_CEILING',
      `${message}: ${aboveCeiling.slice().sort().join(', ')}`
    )
  }
}
