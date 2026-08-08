/**
 * Seat derivation — what the workspace is billed for, computed from the
 * product's own data rather than from anything the provider holds.
 *
 * ## What a seat is
 *
 * A seat is one row in `principal` where `role IN ('admin','member')` **and**
 * `type = 'user'`. That predicate is not invented here: it is the one the
 * product already enforces caps with (`principals/seat-limit.ts`) and already
 * reports on (`GET /api/v1/admin/usage`, `teamSeatCount`), and it is exactly
 * the wall on `/admin` — `admin.tsx` admits `['admin','member']`. So "a seat"
 * and "someone who can open the admin dashboard" are the same set, which is
 * the property that makes it defensible on an invoice.
 *
 * Excluded, and why:
 *   - portal end users (`role = 'user'`) — customers, not staff;
 *   - anonymous visitors (`type = 'anonymous'`) — not people we can bill for;
 *   - service principals (`type = 'service'`) — API keys, integrations and
 *     the control plane's bootstrap principal all carry an admin/member role
 *     but are machines. `seat-limit.ts` excludes them for the same reason.
 *
 * Pending invitations are **not** seats. They become seats on acceptance,
 * which is when the principal row appears. Billing for an unaccepted invite
 * would charge for a person who has never signed in.
 *
 * ## What a lite seat is
 *
 * **There is no lite-seat class in the product today, and this module does
 * not invent a column for one.** Every custom RBAC role rides
 * `principal.role = 'member'` on purpose (`principal.service.ts`: "Custom
 * role grants ride the member role"), so the seat predicate cannot tell an
 * Owner from a read-only custom role. A cheaper seat therefore has to be
 * *derived* from something the product already models.
 *
 * The derivation used here: **a lite seat is a teammate whose entire
 * effective workspace permission set is read-only.** Not a flag an admin can
 * set — a consequence of the access they were actually granted. That matters
 * commercially: to get the cheaper rate you must genuinely give the person no
 * ability to change anything, so the discount cannot be claimed by relabelling.
 *
 * Effective permissions are resolved exactly as the authorization layer
 * resolves them (`permissionsForPrincipal`): workspace-wide role assignments
 * if the principal has any, the legacy preset otherwise. Since both legacy
 * presets (`admin → owner`, `member → manager`) contain write permissions,
 * every principal without a custom role assignment is a full seat, which is
 * the correct answer for every install that has not adopted custom roles.
 *
 * ## Copilot
 *
 * The Copilot add-on is charged per teammate who can actually use Copilot,
 * which the product already models as the `copilot.use` permission — the
 * gate every Copilot entry point checks (`assistant/copilot-gate.ts`). No new
 * concept, and it moves automatically when a role changes.
 */

import {
  and,
  db,
  eq,
  inArray,
  isNull,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
} from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'
import { WRITE_PERMISSIONS } from './permission-classes'

/** Legacy roles that occupy a seat. Mirrors `isTeamMember()`. */
const SEAT_ROLES: Role[] = ['admin', 'member']

export interface SeatCounts {
  /** Teammates holding at least one write permission. */
  full: number
  /** Teammates whose effective permission set is entirely read-only. */
  lite: number
  /** Teammates (of either class) who can use Copilot. */
  copilot: number
  /** `full + lite`. The number `maxTeamSeats` caps and `/admin/usage` reports. */
  total: number
}

export interface SeatBreakdownRow {
  principalId: PrincipalId
  role: Role
  lite: boolean
  copilot: boolean
  permissionCount: number
}

const WRITE_SET: ReadonlySet<PermissionKey> = new Set(WRITE_PERMISSIONS)

/** Classify one already-resolved permission set. Pure — the rule in one place. */
export function classifySeat(effective: ReadonlySet<PermissionKey>): {
  lite: boolean
  copilot: boolean
} {
  let hasWrite = false
  for (const key of effective) {
    if (WRITE_SET.has(key)) {
      hasWrite = true
      break
    }
  }
  return { lite: !hasWrite, copilot: effective.has(PERMISSIONS.COPILOT_USE) }
}

/**
 * Per-teammate seat classification.
 *
 * One query, joined the same way `permissionsForPrincipal` joins for a single
 * principal, then folded in memory. A workspace has tens to hundreds of
 * teammates, so the row count is bounded by (teammates x permissions) and a
 * per-principal query loop would be the wrong trade. Folding in TypeScript
 * rather than SQL is deliberate: the legacy-preset fallback lives in
 * `permissionsForLegacyRole`, and restating it in SQL would create a second
 * copy of the authorization model that could silently drift from the first.
 */
export async function seatBreakdown(): Promise<SeatBreakdownRow[]> {
  const rows = await db
    .select({
      principalId: principal.id,
      role: principal.role,
      assignmentId: principalRoleAssignments.id,
      permissionKey: permissions.key,
    })
    .from(principal)
    .leftJoin(
      principalRoleAssignments,
      and(
        eq(principalRoleAssignments.principalId, principal.id),
        // Workspace-wide grants only. A team-scoped assignment narrows an
        // existing grant rather than conferring workspace access, and
        // `permissionsForPrincipal` reads the same way.
        isNull(principalRoleAssignments.teamId)
      )
    )
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, principalRoleAssignments.roleId))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(principal.type, 'user'), inArray(principal.role, SEAT_ROLES)))

  const byPrincipal = new Map<
    PrincipalId,
    { role: Role; hasAssignment: boolean; keys: Set<PermissionKey> }
  >()

  for (const row of rows) {
    const id = row.principalId as PrincipalId
    let entry = byPrincipal.get(id)
    if (!entry) {
      entry = { role: row.role as Role, hasAssignment: false, keys: new Set() }
      byPrincipal.set(id, entry)
    }
    if (row.assignmentId !== null) entry.hasAssignment = true
    if (row.permissionKey !== null) entry.keys.add(row.permissionKey as PermissionKey)
  }

  const out: SeatBreakdownRow[] = []
  for (const [principalId, entry] of byPrincipal) {
    // Same fallback the authorization layer uses: a principal with no
    // workspace-wide assignment gets its legacy role's preset. Both presets
    // carry write permissions, so this is always a full seat.
    const effective = entry.hasAssignment ? entry.keys : permissionsForLegacyRole(entry.role)
    const { lite, copilot } = classifySeat(effective)
    out.push({
      principalId,
      role: entry.role,
      lite,
      copilot,
      permissionCount: effective.size,
    })
  }
  return out
}

/** The billable seat counts for this workspace. */
export async function countSeats(): Promise<SeatCounts> {
  const rows = await seatBreakdown()
  let full = 0
  let lite = 0
  let copilot = 0
  for (const row of rows) {
    if (row.lite) lite++
    else full++
    if (row.copilot) copilot++
  }
  return { full, lite, copilot, total: full + lite }
}
