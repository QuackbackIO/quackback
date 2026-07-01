import {
  SYSTEM_ROLE_PERMISSIONS,
  presetForLegacyRole,
  type PermissionKey,
} from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'

/**
 * Expand a legacy `principal.role` to its permission set via the seeded preset
 * bundle (admin -> Owner, member -> Manager, user -> none).
 *
 * The compatibility shim: in v1 a caller's permissions are a pure function of the
 * cached role, so this needs no DB read and is provably equivalent to the legacy
 * role check it shadows (the same role string drives both). Phase C grows this
 * into the assignment-derived resolution; the call sites stay identical.
 *
 * The result is memoised per role — the preset bundles are compile-time
 * constants and this runs on every request (requireAuth / withApiKeyAuth /
 * policyActorFromAuth) and every unpopulated-actor `can()`, so a fresh
 * ~50-element Set per call is pure waste. The returned set is treated read-only.
 */
const SET_BY_ROLE = new Map<Role, ReadonlySet<PermissionKey>>()

export function permissionsForLegacyRole(role: Role): ReadonlySet<PermissionKey> {
  let set = SET_BY_ROLE.get(role)
  if (!set) {
    const preset = presetForLegacyRole(role)
    set = new Set(preset ? SYSTEM_ROLE_PERMISSIONS[preset] : [])
    SET_BY_ROLE.set(role, set)
  }
  return set
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
