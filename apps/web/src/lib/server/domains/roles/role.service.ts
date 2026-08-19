/**
 * Custom-role CRUD — the first live consumer of the `role.manage` permission.
 *
 * System presets (isSystem) are read-only here: the seed reconcile in
 * packages/db rewrites their permission bundles on every migrate, so editing
 * them in place would be overwritten. Customs are duplicated from any role (or
 * started blank) and then edited key by key.
 *
 * Safety rails, in order of appearance:
 *  - tier cap: `maxCustomRoles` via the standard count-limit seam (null =
 *    unlimited, the OSS default);
 *  - grant ceiling: an editor can only place permissions they themselves hold
 *    into a role — duplicating intersects (and reports what it dropped),
 *    updating rejects above-ceiling additions outright. This structurally
 *    blocks transitive self-elevation (role.manage + member.manage would
 *    otherwise mint an Owner-equivalent the editor couldn't hold);
 *  - held-role lock: you can't edit or delete a role you currently hold;
 *  - in-use delete: a role with assignments deletes only with an explicit
 *    reassignment target (never the Owner preset — that tier rides the legacy
 *    'admin' role and its promotion path).
 *
 * New catalogue keys ship default-off for custom roles by construction (the
 * seed reconcile never touches non-system roles); `newPermissionKeys` surfaces
 * exactly that gap so the editor can badge keys added since the role's last
 * edit.
 */
import {
  db,
  roles,
  permissions,
  rolePermissions,
  principalRoleAssignments,
  eq,
  and,
  isNull,
  inArray,
  sql,
  type Database,
  type Transaction,
} from '@/lib/server/db'

type Executor = Database | Transaction
import { generateId, type PrincipalId, type RoleId } from '@quackback/ids'
import { SYSTEM_ROLES, type PermissionKey } from '@/lib/shared/permissions'
import { assertKnownPermissions, assertWithinCeiling } from './role.ceiling'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { enforceCountLimit } from '@/lib/server/domains/settings/tier-enforce'
import { recordAuditEvent, type AuditActor } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'role-service' })

/** The acting editor: identity for the held-role lock, set for the ceiling. */
export interface RoleEditor {
  principalId: PrincipalId
  permissions: readonly PermissionKey[]
}

export interface RoleWithMeta {
  id: RoleId
  key: string
  name: string
  description: string | null
  isSystem: boolean
  permissionKeys: PermissionKey[]
  /** Workspace-wide holders (teamId IS NULL assignments). */
  memberCount: number
  /** Catalogue keys added after this role was last edited (customs only). */
  newPermissionKeys: PermissionKey[]
  updatedAt: Date
}

const NAME_MAX = 64

function assertValidName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > NAME_MAX) {
    throw new ValidationError('VALIDATION_ERROR', `Role name must be 1-${NAME_MAX} characters`)
  }
  return trimmed
}

/** Every role (presets first, then customs by name) with permission keys and holder counts. */
export async function listRoles(): Promise<RoleWithMeta[]> {
  const [roleRows, permRows, countRows] = await Promise.all([
    db.select().from(roles),
    db
      .select({ roleId: rolePermissions.roleId, key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)),
    db
      .select({
        roleId: principalRoleAssignments.roleId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(principalRoleAssignments)
      .where(isNull(principalRoleAssignments.teamId))
      .groupBy(principalRoleAssignments.roleId),
  ])

  const keysByRole = new Map<string, PermissionKey[]>()
  for (const row of permRows) {
    const list = keysByRole.get(row.roleId) ?? []
    list.push(row.key as PermissionKey)
    keysByRole.set(row.roleId, list)
  }
  const countByRole = new Map(countRows.map((r) => [r.roleId as string, Number(r.count)]))

  // Keys added to the catalogue after a custom role's last edit land
  // default-off (the seed reconcile never touches custom bundles); surface
  // them so the editor can badge and opt in.
  const permCreated = await db
    .select({ key: permissions.key, createdAt: permissions.createdAt })
    .from(permissions)

  const result = roleRows.map((role) => {
    const held = new Set(keysByRole.get(role.id) ?? [])
    const newKeys = role.isSystem
      ? []
      : permCreated
          .filter((p) => p.createdAt > role.updatedAt && !held.has(p.key as PermissionKey))
          .map((p) => p.key as PermissionKey)
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissionKeys: [...held].sort(),
      memberCount: countByRole.get(role.id) ?? 0,
      newPermissionKeys: newKeys.sort(),
      updatedAt: role.updatedAt,
    }
  })

  const presetOrder = [
    SYSTEM_ROLES.OWNER,
    SYSTEM_ROLES.ADMIN,
    SYSTEM_ROLES.MANAGER,
    SYSTEM_ROLES.CONTRIBUTOR,
  ] as string[]
  return result.sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1
    if (a.isSystem) return presetOrder.indexOf(a.key) - presetOrder.indexOf(b.key)
    return a.name.localeCompare(b.name)
  })
}

export async function loadRole(roleId: RoleId) {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1)
  if (!role) throw new NotFoundError('ROLE_NOT_FOUND', 'Role not found')
  return role
}

export async function permissionKeysForRole(
  exec: Executor,
  roleId: RoleId
): Promise<Set<PermissionKey>> {
  const rows = await exec
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId))
  return new Set(rows.map((r) => r.key as PermissionKey))
}

/** Serializes concurrent edits of one role (and its permission rows). */
async function lockRoleRow(tx: Transaction, roleId: RoleId): Promise<void> {
  await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1).for('update')
}

/**
 * Workspace-wide holders of the role — the same scope memberCount shows and
 * the reassignment moves. Team-scoped grants don't exist yet; when they land,
 * delete/reassign needs its own per-scope pass (a workspace target can't
 * stand in for a team grant).
 */
async function assignmentCount(exec: Executor, roleId: RoleId): Promise<number> {
  const [row] = await exec
    .select({ count: sql<number>`count(*)`.as('count') })
    .from(principalRoleAssignments)
    .where(
      and(eq(principalRoleAssignments.roleId, roleId), isNull(principalRoleAssignments.teamId))
    )
  return Number(row?.count ?? 0)
}

async function assertNotHeldByEditor(roleId: RoleId, editor: RoleEditor, verb: string) {
  const [held] = await db
    .select({ id: principalRoleAssignments.id })
    .from(principalRoleAssignments)
    .where(
      and(
        eq(principalRoleAssignments.principalId, editor.principalId),
        eq(principalRoleAssignments.roleId, roleId)
      )
    )
    .limit(1)
  if (held) {
    throw new ForbiddenError('ROLE_HELD', `You can't ${verb} a role you currently hold`)
  }
}

export interface CreateRoleInput {
  name: string
  description?: string | null
  /**
   * The exact permission set to create the role with. Rejected key-by-key
   * against the editor's own grant ceiling (assignment/authoring parity).
   * The create page sends its staged-and-edited selection here.
   */
  permissionKeys?: PermissionKey[]
  /**
   * Copy this role's permissions (intersected with the editor's own set,
   * dropping what they don't hold). Used when no explicit `permissionKeys` is
   * given — kept for API callers that duplicate without editing.
   */
  duplicateFromRoleId?: RoleId
}

export async function createRole(
  input: CreateRoleInput,
  editor: RoleEditor,
  audit?: { actor: AuditActor; headers?: Headers }
): Promise<{ role: RoleWithMeta; droppedKeys: PermissionKey[] }> {
  const name = assertValidName(input.name)
  const held = new Set(editor.permissions)

  let grantedKeys: PermissionKey[] = []
  let droppedKeys: PermissionKey[] = []
  if (input.permissionKeys) {
    assertKnownPermissions(input.permissionKeys)
    assertWithinCeiling(input.permissionKeys, held)
    grantedKeys = [...new Set(input.permissionKeys)]
  } else if (input.duplicateFromRoleId) {
    const source = await loadRole(input.duplicateFromRoleId)
    const sourceKeys = await permissionKeysForRole(db, source.id)
    grantedKeys = [...sourceKeys].filter((k) => held.has(k))
    droppedKeys = [...sourceKeys].filter((k) => !held.has(k)).sort()
  }

  const id = generateId('role') as RoleId
  await db.transaction(async (tx) => {
    // Serialize concurrent creates so the tier-cap count can't be raced past.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7061637)`)
    const limits = await getTierLimits()
    await enforceCountLimit({
      limit: limits.maxCustomRoles,
      currentCount: async () => {
        const [row] = await tx
          .select({ count: sql<number>`count(*)`.as('count') })
          .from(roles)
          .where(eq(roles.isSystem, false))
        return Number(row?.count ?? 0)
      },
      name: 'custom_roles',
      friendly: 'custom roles',
    })
    await tx.insert(roles).values({
      id,
      // Customs have no semantic key; the id keeps it unique and stable.
      key: id,
      name,
      description: input.description?.trim() || null,
      isSystem: false,
    })
    if (grantedKeys.length > 0) {
      const permRows = await tx
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.key, grantedKeys))
      await tx
        .insert(rolePermissions)
        .values(permRows.map((p) => ({ roleId: id, permissionId: p.id })))
    }
  })

  if (audit) {
    await recordAuditEvent({
      event: 'role.created',
      actor: audit.actor,
      headers: audit.headers,
      target: { type: 'role', id },
      after: {
        name,
        permissionCount: grantedKeys.length,
        duplicatedFrom: input.duplicateFromRoleId ?? null,
      },
    })
  }
  log.info({ role_id: id, permission_count: grantedKeys.length }, 'custom role created')

  const [role] = (await listRoles()).filter((r) => r.id === id)
  return { role, droppedKeys }
}

export interface UpdateRoleInput {
  name?: string
  description?: string | null
  permissionKeys?: PermissionKey[]
}

export async function updateRole(
  roleId: RoleId,
  input: UpdateRoleInput,
  editor: RoleEditor,
  audit?: { actor: AuditActor; headers?: Headers }
): Promise<RoleWithMeta> {
  const role = await loadRole(roleId)
  if (role.isSystem) {
    throw new ForbiddenError('SYSTEM_ROLE', 'System roles are read-only; duplicate one instead')
  }
  await assertNotHeldByEditor(roleId, editor, 'edit')

  let nextKeys: Set<PermissionKey> | null = null
  if (input.permissionKeys) {
    assertKnownPermissions(input.permissionKeys)
    nextKeys = new Set(input.permissionKeys)
  }

  let auditedBeforeCount = 0
  await db.transaction(async (tx) => {
    // Lock the role row so concurrent edits serialize: without it two diffs
    // against the same stale snapshot union-merge instead of last-write-wins.
    await lockRoleRow(tx, roleId)
    const current = await permissionKeysForRole(tx, roleId)
    auditedBeforeCount = current.size

    if (nextKeys) {
      // Additions only: keys already on the role stay even if the editor no
      // longer holds them (de-escalation is free; retaining is not a grant).
      const held = new Set(editor.permissions)
      assertWithinCeiling(
        [...nextKeys].filter((k) => !current.has(k)),
        held
      )
    }

    await tx
      .update(roles)
      .set({
        ...(input.name !== undefined ? { name: assertValidName(input.name) } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(roles.id, roleId))

    if (nextKeys) {
      const toAdd = [...nextKeys].filter((k) => !current.has(k))
      const toRemove = [...current].filter((k) => !nextKeys.has(k))
      if (toAdd.length > 0) {
        const permRows = await tx
          .select({ id: permissions.id, key: permissions.key })
          .from(permissions)
          .where(inArray(permissions.key, toAdd))
        await tx
          .insert(rolePermissions)
          .values(permRows.map((p) => ({ roleId, permissionId: p.id })))
          .onConflictDoNothing()
      }
      if (toRemove.length > 0) {
        const permRows = await tx
          .select({ id: permissions.id })
          .from(permissions)
          .where(inArray(permissions.key, toRemove))
        await tx.delete(rolePermissions).where(
          and(
            eq(rolePermissions.roleId, roleId),
            inArray(
              rolePermissions.permissionId,
              permRows.map((p) => p.id)
            )
          )
        )
      }
    }
  })

  if (audit) {
    await recordAuditEvent({
      event: 'role.updated',
      actor: audit.actor,
      headers: audit.headers,
      target: { type: 'role', id: roleId },
      before: { permissionCount: auditedBeforeCount },
      after: {
        name: input.name ?? role.name,
        permissionCount: nextKeys ? nextKeys.size : auditedBeforeCount,
      },
    })
  }

  const [updated] = (await listRoles()).filter((r) => r.id === roleId)
  return updated
}

export interface DeleteRoleInput {
  /** Required when the role has holders; every assignment moves here. */
  reassignToRoleId?: RoleId
}

export async function deleteRole(
  roleId: RoleId,
  input: DeleteRoleInput,
  editor: RoleEditor,
  audit?: { actor: AuditActor; headers?: Headers }
): Promise<{ reassignedCount: number }> {
  const role = await loadRole(roleId)
  if (role.isSystem) {
    throw new ForbiddenError('SYSTEM_ROLE', 'System roles cannot be deleted')
  }
  await assertNotHeldByEditor(roleId, editor, 'delete')

  let reassignTo: RoleId | null = null
  if (input.reassignToRoleId) {
    const target = await loadRole(input.reassignToRoleId)
    if (target.id === roleId) {
      throw new ValidationError('VALIDATION_ERROR', 'Cannot reassign a role to itself')
    }
    if (target.key === SYSTEM_ROLES.OWNER) {
      throw new ForbiddenError(
        'FORBIDDEN',
        'Reassigning to Owner is not allowed; promote members individually instead'
      )
    }
    // Reassignment is a grant: the same ceiling as create/update applies, or
    // deleting a throwaway role becomes a path to hand out bundles (the Admin
    // preset, a billing-bearing custom) the editor doesn't hold.
    const targetKeys = await permissionKeysForRole(db, target.id)
    assertWithinCeiling(
      [...targetKeys],
      new Set(editor.permissions),
      "You can't reassign members to a role with permissions you don't hold"
    )
    reassignTo = target.id
  }

  let holders = 0
  await db.transaction(async (tx) => {
    // Lock the role row: a concurrent assignment insert (updateMemberRole)
    // takes FOR KEY SHARE on it, so the two serialize instead of a fresh
    // holder slipping in after the reassign snapshot and being cascade-lost.
    await lockRoleRow(tx, roleId)
    holders = await assignmentCount(tx, roleId)
    if (holders > 0 && !reassignTo) {
      throw new ValidationError(
        'ROLE_IN_USE',
        `${holders} member${holders === 1 ? '' : 's'} hold this role; choose a role to move them to`
      )
    }

    if (reassignTo && holders > 0) {
      const rows = await tx
        .select({ principalId: principalRoleAssignments.principalId })
        .from(principalRoleAssignments)
        .where(
          and(eq(principalRoleAssignments.roleId, roleId), isNull(principalRoleAssignments.teamId))
        )
      if (rows.length > 0) {
        await tx
          .insert(principalRoleAssignments)
          .values(
            rows.map((r) => ({
              principalId: r.principalId,
              roleId: reassignTo as RoleId,
              grantedByPrincipalId: editor.principalId,
            }))
          )
          .onConflictDoNothing()
      }
    }
    // Cascade clears role_permissions and any remaining assignment rows.
    await tx.delete(roles).where(eq(roles.id, roleId))
  })

  if (audit) {
    await recordAuditEvent({
      event: 'role.deleted',
      actor: audit.actor,
      headers: audit.headers,
      target: { type: 'role', id: roleId },
      before: { name: role.name, holders },
      after: { reassignedTo: reassignTo },
    })
  }
  log.info({ role_id: roleId, holders, reassigned_to: reassignTo }, 'custom role deleted')

  return { reassignedCount: holders }
}
