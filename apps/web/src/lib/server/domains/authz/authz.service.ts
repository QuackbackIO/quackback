/**
 * AuthzService — load + evaluate permissions for a principal.
 *
 * Source of truth: `principal_role_assignments` → `role_permissions` →
 * `permissions`. The legacy `principal.role` column remains a denormalised
 * cache so existing call sites keep working.
 *
 * Per-request caching is intentionally NOT done here (the layer is stateless);
 * `auth-helpers.ts` calls `loadPermissionSet` once when building `AuthContext`
 * and stashes the result on the context object passed down the request.
 */

import {
  db,
  eq,
  inArray,
  principal,
  principalRoleAssignments,
  rolePermissions,
  permissions as permissionsTable,
  teamMemberships,
} from '@/lib/server/db'
import type { PrincipalId, TeamId } from '@quackback/ids'
import { ForbiddenError } from '@/lib/shared/errors'
import {
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  type PermissionKey,
} from './authz.permissions'
import {
  matchesAssignedScope,
  matchesSharedScope,
  matchesTeamScope,
  type ActorScope,
  type ResourceScope,
  type ScopeMatch,
} from './authz.scopes'

/**
 * Permission set held by a principal, indexed for fast lookup.
 */
export interface PermissionSet {
  principalId: PrincipalId
  /** All permissions held workspace-wide (team_id IS NULL grants). */
  workspacePermissions: ReadonlySet<PermissionKey>
  /** Map team_id → set of permissions granted by team-scoped role assignments. */
  teamPermissions: ReadonlyMap<TeamId, ReadonlySet<PermissionKey>>
  /** Teams the principal is a member of (independent of permission grants). */
  teamIds: readonly TeamId[]
}

/**
 * Build the permission set for a principal.
 *
 * Falls back to the legacy `principal.role` column when no role assignments
 * exist yet (i.e. before the seed migration has run on a given workspace).
 * This keeps the system safe to deploy in any order: ship code first, run
 * migration later.
 */
export async function loadPermissionSet(principalId: PrincipalId): Promise<PermissionSet> {
  // Team memberships are needed regardless of the grant lookup outcome.
  const memberships = await db.query.teamMemberships.findMany({
    where: eq(teamMemberships.principalId, principalId),
    columns: { teamId: true },
  })
  const teamIds = memberships.map((m) => m.teamId as TeamId)

  // Load every grant for this principal plus the permissions attached to each
  // role. We do this in two queries (assignments → role IDs → permissions) to
  // keep the query plans simple and indexable.
  const assignments = await db.query.principalRoleAssignments.findMany({
    where: eq(principalRoleAssignments.principalId, principalId),
    columns: { roleId: true, teamId: true },
  })

  if (assignments.length === 0) {
    return legacyFallback(principalId, teamIds)
  }

  const roleIds = Array.from(new Set(assignments.map((a) => a.roleId)))
  const grants = await db
    .select({
      roleId: rolePermissions.roleId,
      key: permissionsTable.key,
    })
    .from(rolePermissions)
    .innerJoin(permissionsTable, eq(rolePermissions.permissionId, permissionsTable.id))
    .where(inArray(rolePermissions.roleId, roleIds))

  const permissionsByRole = new Map<string, PermissionKey[]>()
  for (const grant of grants) {
    const existing = permissionsByRole.get(grant.roleId) ?? []
    existing.push(grant.key as PermissionKey)
    permissionsByRole.set(grant.roleId, existing)
  }

  const workspacePermissions = new Set<PermissionKey>()
  const teamPermissions = new Map<TeamId, Set<PermissionKey>>()

  for (const assignment of assignments) {
    const perms = permissionsByRole.get(assignment.roleId) ?? []
    if (assignment.teamId == null) {
      for (const p of perms) workspacePermissions.add(p)
    } else {
      const teamId = assignment.teamId as TeamId
      const bucket = teamPermissions.get(teamId) ?? new Set<PermissionKey>()
      for (const p of perms) bucket.add(p)
      teamPermissions.set(teamId, bucket)
    }
  }

  return {
    principalId,
    workspacePermissions,
    teamPermissions: new Map(
      Array.from(teamPermissions.entries()).map(([k, v]) => [k, v as ReadonlySet<PermissionKey>])
    ),
    teamIds,
  }
}

/**
 * Pre-migration fallback: synthesise a permission set from `principal.role`.
 */
async function legacyFallback(
  principalId: PrincipalId,
  teamIds: readonly TeamId[]
): Promise<PermissionSet> {
  const record = await db.query.principal.findFirst({
    where: eq(principal.id, principalId),
    columns: { role: true },
  })
  const legacyRole = record?.role ?? 'user'
  const mapped =
    legacyRole === 'admin'
      ? SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.OWNER]
      : legacyRole === 'member'
        ? SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.AGENT]
        : SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.CUSTOMER]
  return {
    principalId,
    workspacePermissions: new Set(mapped),
    teamPermissions: new Map(),
    teamIds,
  }
}

/**
 * Return true if the principal holds `permission` in *some* scope.
 *
 * Use `hasPermissionForResource` for the common ticketing case where the
 * permission must apply to a specific resource.
 */
export function hasPermission(set: PermissionSet, permission: PermissionKey): boolean {
  if (set.workspacePermissions.has(permission)) return true
  for (const perms of set.teamPermissions.values()) {
    if (perms.has(permission)) return true
  }
  return false
}

/**
 * Return true if the principal holds `permission` *for the given resource*.
 *
 * Workspace-wide grants always match. Team-scoped grants only match when the
 * resource lives in (or is shared with) one of the granted teams.
 */
export function hasPermissionForResource(
  set: PermissionSet,
  permission: PermissionKey,
  resource: ResourceScope
): boolean {
  if (set.workspacePermissions.has(permission)) return true
  for (const [teamId, perms] of set.teamPermissions.entries()) {
    if (!perms.has(permission)) continue
    if (resource.primaryTeamId === teamId) return true
    if (resource.assigneeTeamId === teamId) return true
    if (resource.sharedTeamIds?.includes(teamId)) return true
  }
  return false
}

/**
 * Decide whether the principal can *view* a ticket-shaped resource, returning
 * the matching scope so the UI can render an accurate visibility chip.
 *
 * Tries permissions from broadest to narrowest:
 *   1. ticket.view_all            → reason 'all'
 *   2. ticket.view_team           → reason 'team'
 *   3. ticket.view_shared         → reason 'shared'
 *   4. ticket.view_assigned       → reason 'assigned'
 */
export function evaluateTicketView(set: PermissionSet, resource: ResourceScope): ScopeMatch {
  const actor: ActorScope = { principalId: set.principalId, teamIds: set.teamIds }

  if (hasPermission(set, PERMISSIONS.TICKET_VIEW_ALL)) {
    return { inScope: true, reason: 'all' }
  }
  if (hasPermissionForResource(set, PERMISSIONS.TICKET_VIEW_TEAM, resource)) {
    const m = matchesTeamScope(actor, resource)
    if (m.inScope) return m
  }
  if (hasPermissionForResource(set, PERMISSIONS.TICKET_VIEW_SHARED, resource)) {
    const m = matchesSharedScope(actor, resource)
    if (m.inScope) return m
  }
  if (hasPermissionForResource(set, PERMISSIONS.TICKET_VIEW_ASSIGNED, resource)) {
    const m = matchesAssignedScope(actor, resource)
    if (m.inScope) return m
  }
  return { inScope: false, reason: 'none' }
}

/**
 * Throw a `ForbiddenError` if the principal lacks the permission.
 * For resource-scoped checks, pass `resource`.
 */
export function assertPermission(
  set: PermissionSet,
  permission: PermissionKey,
  resource?: ResourceScope
): void {
  const ok = resource
    ? hasPermissionForResource(set, permission, resource)
    : hasPermission(set, permission)
  if (!ok) {
    throw new ForbiddenError('PERMISSION_DENIED', `Missing required permission: ${permission}`)
  }
}
