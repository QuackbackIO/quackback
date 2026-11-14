import {
  SYSTEM_ROLE_PERMISSIONS,
  presetForLegacyRole,
  type PermissionKey,
} from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'
import type { PrincipalId } from '@quackback/ids'
import {
  and,
  db,
  eq,
  inArray,
  isNull,
  permissions,
  principalRoleAssignments,
  rolePermissions,
  type Database,
  type Transaction,
} from '@/lib/server/db'

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
 * Legacy-preset expansion of a role string (no DB read). Real request paths
 * resolve assignment-derived sets once at the gate (requireAuth /
 * requireWorkspaceRole / getOptionalAuth) and thread them through actors and
 * contexts; this remains the fallback for synthetic actors without a resolved
 * set, and the deliberate resolution for API keys (machine principals ride
 * presets; key authority stays owner-preset ∩ scopes). A null role
 * (anonymous) holds nothing.
 */
export function resolveActorPermissions(role: Role | null): ReadonlySet<PermissionKey> {
  return role ? permissionsForLegacyRole(role) : new Set()
}

/** Resolve workspace-wide role assignments, with a legacy fallback for unmigrated principals. */
export async function permissionsForPrincipal(
  principalId: PrincipalId,
  legacyRole: Role,
  executor: Database | Transaction = db
): Promise<ReadonlySet<PermissionKey>> {
  const rows = await executor
    .select({ assignmentId: principalRoleAssignments.id, key: permissions.key })
    .from(principalRoleAssignments)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, principalRoleAssignments.roleId))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(principalRoleAssignments.principalId, principalId),
        isNull(principalRoleAssignments.teamId)
      )
    )

  if (rows.length === 0) return permissionsForLegacyRole(legacyRole)
  return new Set(rows.flatMap((row) => (row.key === null ? [] : [row.key as PermissionKey])))
}

/**
 * {@link permissionsForPrincipal} for many principals in one read: each one's
 * workspace-wide assignments, or its legacy role's bundle when it has none.
 */
export async function permissionsForPrincipals(
  people: readonly { id: PrincipalId; role: Role }[],
  executor: Database | Transaction = db
): Promise<Map<PrincipalId, ReadonlySet<PermissionKey>>> {
  if (people.length === 0) return new Map()
  const rows = await executor
    .select({ principalId: principalRoleAssignments.principalId, key: permissions.key })
    .from(principalRoleAssignments)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, principalRoleAssignments.roleId))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        inArray(
          principalRoleAssignments.principalId,
          people.map((p) => p.id)
        ),
        isNull(principalRoleAssignments.teamId)
      )
    )
  const assigned = new Map<PrincipalId, Set<PermissionKey>>()
  for (const row of rows) {
    const id = row.principalId as PrincipalId
    const held = assigned.get(id) ?? new Set<PermissionKey>()
    if (row.key !== null) held.add(row.key as PermissionKey)
    assigned.set(id, held)
  }
  return new Map(people.map((p) => [p.id, assigned.get(p.id) ?? permissionsForLegacyRole(p.role)]))
}
