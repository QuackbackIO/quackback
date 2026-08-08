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
 * > *A lite seat is read-only on the customer support side.* (operator)
 *
 * **There is no lite-seat class in the product today, and this module does
 * not invent a column for one.** Every custom RBAC role rides
 * `principal.role = 'member'` on purpose (`principal.service.ts`: "Custom
 * role grants ride the member role"), so the seat predicate cannot tell an
 * Owner from a read-only custom role. A cheaper seat therefore has to be
 * *derived* from something the product already models.
 *
 * The derivation: **a lite seat is a teammate who holds no write permission
 * on the customer-support surface** — conversations, tickets and the inbox —
 * regardless of what they can do elsewhere. So a product manager who writes
 * freely on feedback boards and roadmaps but only observes the support inbox
 * is a lite seat. Full seats are support agents; lite seats are everyone else
 * who needs visibility. The surface itself is derived from the permission
 * catalogue's own categories in `permission-classes.ts`.
 *
 * Not a flag an admin can set — a consequence of the access actually granted.
 * That matters commercially: the cheaper rate requires genuinely withholding
 * every support-side write, so the discount cannot be claimed by relabelling.
 *
 * Effective permissions are resolved exactly as the authorization layer
 * resolves them (`permissionsForPrincipal`): workspace-wide role assignments
 * if the principal has any, the legacy preset otherwise. Since both legacy
 * presets (`admin → owner`, `member → manager`) contain support writes, every
 * principal without a custom role assignment is a full seat, which is the
 * correct answer for every install that has not adopted custom roles.
 *
 * ## Copilot
 *
 * > *Copilot bills per paid user/month.* (operator)
 *
 * So the billed quantity is **full seats**, not the number of teammates
 * holding `copilot.use`. The permission still decides who may *use* Copilot —
 * `assistant/copilot-gate.ts` is unchanged — but it no longer decides what is
 * charged, and `copilotEligible` below is reported for the admin surface
 * only, deliberately named so it cannot be mistaken for a billing quantity.
 *
 * Lite seats are excluded from the add-on: a read-only support viewer has no
 * write action for Copilot to assist, so charging them for a capability they
 * cannot exercise would be wrong. That exclusion is an assumption, recorded
 * in BILLING.md so it is cheap to reverse.
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
import { SUPPORT_WRITE_PERMISSIONS } from './permission-classes'

/** Legacy roles that occupy a seat. Mirrors `isTeamMember()`. */
const SEAT_ROLES: Role[] = ['admin', 'member']

export interface SeatCounts {
  /** Teammates holding at least one customer-support write permission. */
  full: number
  /** Teammates with no customer-support write permission. */
  lite: number
  /**
   * Teammates who may use Copilot, by permission.
   *
   * Reporting only. The Copilot add-on bills per paid user, so its quantity
   * is `full` — see `desiredQuantities()`. Named `copilotEligible` rather
   * than `copilot` precisely so it cannot be picked up as a billing figure by
   * someone reading the shape rather than the docs.
   */
  copilotEligible: number
  /** `full + lite`. The number `maxTeamSeats` caps and `/admin/usage` reports. */
  total: number
}

export interface SeatBreakdownRow {
  principalId: PrincipalId
  role: Role
  lite: boolean
  copilotEligible: boolean
  permissionCount: number
}

const SUPPORT_WRITE_SET: ReadonlySet<PermissionKey> = new Set(SUPPORT_WRITE_PERMISSIONS)

/** Classify one already-resolved permission set. Pure — the rule in one place. */
export function classifySeat(effective: ReadonlySet<PermissionKey>): {
  lite: boolean
  copilotEligible: boolean
} {
  let hasSupportWrite = false
  for (const key of effective) {
    if (SUPPORT_WRITE_SET.has(key)) {
      hasSupportWrite = true
      break
    }
  }
  return {
    lite: !hasSupportWrite,
    copilotEligible: effective.has(PERMISSIONS.COPILOT_USE),
  }
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
    const { lite, copilotEligible } = classifySeat(effective)
    out.push({
      principalId,
      role: entry.role,
      lite,
      copilotEligible,
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
  let copilotEligible = 0
  for (const row of rows) {
    if (row.lite) lite++
    else full++
    if (row.copilotEligible) copilotEligible++
  }
  return { full, lite, copilotEligible, total: full + lite }
}
