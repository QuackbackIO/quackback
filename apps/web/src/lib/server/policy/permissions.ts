import { SYSTEM_ROLE_PERMISSIONS, presetForLegacyRole, type PermissionKey } from '@/lib/server/db'
import type { Role } from '@/lib/shared/roles'

/**
 * Expand a legacy `principal.role` to its permission set via the seeded preset
 * bundle (admin -> Owner, member -> Manager, user -> none).
 *
 * The compatibility shim: in v1 a caller's permissions are a pure function of the
 * cached role, so this needs no DB read and is provably equivalent to the legacy
 * role check it shadows (the same role string drives both). Phase C grows this
 * into the assignment-derived resolution; the call sites stay identical.
 */
export function permissionsForLegacyRole(role: Role): ReadonlySet<PermissionKey> {
  const preset = presetForLegacyRole(role)
  return new Set(preset ? SYSTEM_ROLE_PERMISSIONS[preset] : [])
}

/**
 * Resolve an actor's permission set from its role. The seam every Actor
 * construction site funnels through. v1 is the pure preset expansion above (no
 * DB read); the custom-role era swaps the body for a
 * `principal_role_assignments ⋈ role_permissions` join keyed on the principal,
 * leaving every caller unchanged. A null role (anonymous) holds nothing.
 */
export function resolveActorPermissions(role: Role | null): ReadonlySet<PermissionKey> {
  return role ? permissionsForLegacyRole(role) : new Set()
}
