/**
 * System-data seed — idempotent reconcile of the reference data every workspace
 * needs to function: default post statuses, the RBAC permission catalogue, the
 * four system-role presets, and their role -> permission bundles.
 *
 * Distinct from src/seed.ts (the dev demo-content generator). This runs on every
 * migrate (both the CLI and the runtime entrypoint) and is safe to re-run: it
 * inserts what is missing and reconciles drift (a permission's category or
 * description, a preset's bundle) without duplicating rows.
 */
import { and, eq, inArray, isNull, ne, notExists } from 'drizzle-orm'
import type { Database } from './client'
import { postStatuses, DEFAULT_STATUSES } from './schema/statuses'
import { ticketStatuses, DEFAULT_TICKET_STATUSES } from './schema/tickets'
import { principal } from './schema/auth'
import { roles, permissions, rolePermissions, principalRoleAssignments } from './schema/rbac'
import {
  PERMISSION_CATALOGUE,
  SYSTEM_ROLES,
  SYSTEM_ROLE_DEFS,
  SYSTEM_ROLE_PERMISSIONS,
  type SystemRoleKey,
} from './rbac-catalogue'

/** The live db or an open transaction — both expose select/insert/delete. */
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export async function seedSystemData(db: Executor): Promise<void> {
  // 1. Default post statuses — the post service needs an `open` default to
  //    create the very first post. Seed only when the table is empty.
  const existingStatus = await db.select({ id: postStatuses.id }).from(postStatuses).limit(1)
  if (existingStatus.length === 0) {
    await db.insert(postStatuses).values(DEFAULT_STATUSES)
  }

  // 1b. Default ticket statuses (support platform §4.2) — the ticket service
  //     needs a default 'New' status to create the first ticket. Seed only when
  //     the table is empty, mirroring post statuses.
  const existingTicketStatus = await db
    .select({ id: ticketStatuses.id })
    .from(ticketStatuses)
    .limit(1)
  if (existingTicketStatus.length === 0) {
    await db.insert(ticketStatuses).values(DEFAULT_TICKET_STATUSES)
  }

  // 2. Permissions — upsert each catalogue entry by key; reconcile category /
  //    description drift on re-run.
  for (const p of PERMISSION_CATALOGUE) {
    await db
      .insert(permissions)
      .values({ key: p.key, category: p.category, description: p.description, isSystem: true })
      .onConflictDoUpdate({
        target: permissions.key,
        set: { category: p.category, description: p.description, isSystem: true },
      })
  }

  // 3. System roles — upsert the four presets by key.
  for (const r of SYSTEM_ROLE_DEFS) {
    await db
      .insert(roles)
      .values({ key: r.key, name: r.name, description: r.description, isSystem: true })
      .onConflictDoUpdate({
        target: roles.key,
        set: { name: r.name, description: r.description, isSystem: true },
      })
  }

  // 4. role_permissions — reconcile each preset's bundle to SYSTEM_ROLE_PERMISSIONS
  //    (insert missing, delete stale) so a bundle edit propagates on the next run.
  const permRows = await db.select({ id: permissions.id, key: permissions.key }).from(permissions)
  const permIdByKey = new Map(permRows.map((p) => [p.key, p.id]))
  const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles)
  const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]))

  for (const roleKey of Object.keys(SYSTEM_ROLE_PERMISSIONS) as SystemRoleKey[]) {
    const roleId = roleIdByKey.get(roleKey)
    if (!roleId) continue

    const desired = new Set(
      SYSTEM_ROLE_PERMISSIONS[roleKey]
        .map((k) => permIdByKey.get(k))
        .filter((id): id is NonNullable<typeof id> => id != null)
    )

    const existing = await db
      .select({ id: rolePermissions.id, permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId))
    const existingByPerm = new Map(existing.map((e) => [e.permissionId, e.id]))

    const toInsert = [...desired]
      .filter((permId) => !existingByPerm.has(permId))
      .map((permId) => ({ roleId, permissionId: permId }))
    if (toInsert.length > 0) {
      await db.insert(rolePermissions).values(toInsert).onConflictDoNothing()
    }

    const toDelete = existing.filter((e) => !desired.has(e.permissionId)).map((e) => e.id)
    if (toDelete.length > 0) {
      await db.delete(rolePermissions).where(inArray(rolePermissions.id, toDelete))
    }
  }

  // 5a. Heal the pre-reconcile era. This backfill used to run without
  //     setPrincipalRole keeping assignments in sync, so a demoted or removed
  //     teammate could keep the Owner/Manager row an earlier run seeded — a
  //     removed admin still passing every permission gate. Delete
  //     backfill-owned rows (Owner/Manager preset, workspace-wide) whose
  //     holder's legacy role no longer maps to them. Explicit grants are never
  //     touched: custom roles and other presets don't match the two role ids,
  //     and explicit grants record their grantor while backfill/reconcile rows
  //     leave grantedByPrincipalId NULL.
  const healTargets = [
    { roleId: roleIdByKey.get(SYSTEM_ROLES.OWNER), legacyRole: 'admin' },
    { roleId: roleIdByKey.get(SYSTEM_ROLES.MANAGER), legacyRole: 'member' },
  ]
  for (const { roleId, legacyRole } of healTargets) {
    if (!roleId) continue
    await db
      .delete(principalRoleAssignments)
      .where(
        and(
          eq(principalRoleAssignments.roleId, roleId),
          isNull(principalRoleAssignments.teamId),
          isNull(principalRoleAssignments.grantedByPrincipalId),
          inArray(
            principalRoleAssignments.principalId,
            db.select({ id: principal.id }).from(principal).where(ne(principal.role, legacyRole))
          )
        )
      )
  }

  // 5b. Backfill principal_role_assignments from the legacy principal.role cache:
  //    admin -> Owner, member -> Manager, user -> no assignment (service
  //    principals map the same way). Ordered after the preset seed so the role
  //    ids exist. Skips principals that already hold ANY workspace-wide
  //    assignment, so an explicit grant (a custom role) is never silently
  //    augmented with a second preset row. Idempotent: the partial unique index
  //    (principal_id, role_id) WHERE team_id IS NULL backstops
  //    onConflictDoNothing.
  const legacyToPreset: Record<string, SystemRoleKey> = {
    admin: SYSTEM_ROLES.OWNER,
    member: SYSTEM_ROLES.MANAGER,
  }
  const legacyPrincipals = await db
    .select({ id: principal.id, role: principal.role })
    .from(principal)
    .where(
      and(
        inArray(principal.role, Object.keys(legacyToPreset)),
        notExists(
          db
            .select({ id: principalRoleAssignments.id })
            .from(principalRoleAssignments)
            .where(
              and(
                eq(principalRoleAssignments.principalId, principal.id),
                isNull(principalRoleAssignments.teamId)
              )
            )
        )
      )
    )

  const assignments: (typeof principalRoleAssignments.$inferInsert)[] = []
  for (const p of legacyPrincipals) {
    const roleId = roleIdByKey.get(legacyToPreset[p.role])
    if (roleId) assignments.push({ principalId: p.id, roleId })
  }
  if (assignments.length > 0) {
    await db.insert(principalRoleAssignments).values(assignments).onConflictDoNothing()
  }
}
