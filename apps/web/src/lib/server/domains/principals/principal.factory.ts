/**
 * Principal factory — the single place that CREATES a principal and the single
 * place that WRITES the principal.role column.
 *
 * Scope: this module owns every principal INSERT and every role write. It does
 * NOT own a small set of cache-safe, column-scoped direct writes other domains
 * make (the conversation flow captures `contactEmail` with an overwrite-once guard;
 * presence writes `chatAvailability`) — those columns are never read by the principal
 * role/type cache, so they stay where they are.
 *
 * Every role write also reconciles the principal's workspace-wide row in
 * principal_role_assignments in the same transaction: the assignment is what
 * permissionsForPrincipal actually reads, so a role write that skipped it would
 * leave the old grant live (a removed teammate keeping Owner permissions).
 * Every function takes an optional `Executor` so a caller can enlist the write
 * in its own transaction.
 */
import {
  db,
  principal,
  principalRoleAssignments,
  roles,
  session,
  user,
  eq,
  ne,
  and,
  isNull,
  sql,
  type Principal,
  type ServiceMetadata,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { generateId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { isTeamMember, type Role, type PrincipalType } from '@/lib/shared/roles'
import { presetForLegacyRole } from '@/lib/shared/permissions'
import { cacheDel, CACHE_KEYS } from '@/lib/server/redis'
import { addPrincipalToDefaultTeam } from '@/lib/server/domains/teams'
import { ForbiddenError } from '@/lib/shared/errors'

/** The live db or an open transaction — both expose insert/update/query. */
export type Executor = Database | Transaction

/** Address a principal by its id (exact) or by its owning user. */
export type PrincipalRef = { principalId: PrincipalId } | { userId: UserId }

interface ProfileFields {
  displayName?: string | null
  avatarUrl?: string | null
  avatarKey?: string | null
  serviceMetadata?: ServiceMetadata | null
  lastSsoSignInAt?: Date | null
  contactEmail?: string | null
}

// ------------------------------------------------------------------ create ---

export interface CreatePrincipalInput extends ProfileFields {
  /** Role cache column. REQUIRED on every create (no schema-default fallback). */
  role: Role
  type?: PrincipalType
  userId?: UserId | null
  id?: PrincipalId
}

/** The one place principal column defaults live. createdAt is always stamped
 *  (the column is notNull with no DB default). */
function toRow(input: CreatePrincipalInput): typeof principal.$inferInsert {
  return {
    id: input.id ?? generateId('principal'),
    userId: input.userId ?? null,
    role: input.role,
    type: input.type ?? 'user',
    displayName: input.displayName ?? null,
    avatarUrl: input.avatarUrl ?? null,
    avatarKey: input.avatarKey ?? null,
    serviceMetadata: input.serviceMetadata ?? null,
    lastSsoSignInAt: input.lastSsoSignInAt ?? null,
    contactEmail: input.contactEmail ?? null,
    createdAt: new Date(),
  }
}

/**
 * Enroll a freshly-created team-tier principal in the default team (§4.12).
 * End-users, anonymous visitors and service principals are skipped; a missing
 * default team or a duplicate membership is a no-op. Enlists in the caller's
 * executor so it is atomic with the principal insert (e.g. invitation accept).
 */
async function enrollTeamTierInDefaultTeam(created: Principal, exec: Executor): Promise<void> {
  if (created.type !== 'user' || !isTeamMember(created.role)) return
  await addPrincipalToDefaultTeam(created.id, exec)
}

/** Insert one brand-new principal. Use only where no concurrent creator can race. */
export async function createPrincipal(
  input: CreatePrincipalInput,
  exec: Executor = db
): Promise<Principal> {
  const [created] = await exec.insert(principal).values(toRow(input)).returning()
  await enrollTeamTierInDefaultTeam(created, exec)
  return created
}

/** Insert many brand-new principals in one statement. */
export async function createPrincipals(
  inputs: CreatePrincipalInput[],
  exec: Executor = db
): Promise<Principal[]> {
  if (inputs.length === 0) return []
  const created = await exec.insert(principal).values(inputs.map(toRow)).returning()
  for (const row of created) await enrollTeamTierInDefaultTeam(row, exec)
  return created
}

// ------------------------------------------------- idempotent lazy create ---

export interface EnsurePrincipalInput extends ProfileFields {
  userId: UserId
  role: Role
  type?: Extract<PrincipalType, 'user' | 'anonymous'>
  id?: PrincipalId
}

/**
 * Race-safe lazy create for a user row that already exists. Read-first, so a
 * hot path where the principal almost always exists costs one query; on a miss
 * it inserts with `onConflictDoNothing` (the partial unique index on `user_id`
 * is the backstop) and re-reads the winner on a lost race. Returns the existing
 * or newly-created principal plus whether it inserted. Busts the principal cache
 * only when it actually inserts.
 */
export async function ensurePrincipalForUser(
  input: EnsurePrincipalInput,
  exec: Executor = db
): Promise<{ principal: Principal; created: boolean }> {
  const existing = await exec.query.principal.findFirst({
    where: eq(principal.userId, input.userId),
  })
  if (existing) return { principal: existing, created: false }

  const [inserted] = await exec
    .insert(principal)
    .values(toRow(input))
    .onConflictDoNothing()
    .returning()
  if (inserted) {
    await enrollTeamTierInDefaultTeam(inserted, exec)
    await cacheDel(CACHE_KEYS.PRINCIPAL_BY_USER(input.userId))
    return { principal: inserted, created: true }
  }

  // Lost a concurrent first-touch: the winner is now present.
  const winner = await exec.query.principal.findFirst({
    where: eq(principal.userId, input.userId),
  })
  return { principal: winner as Principal, created: false }
}

// ------------------------------------------------------- service principal ---

/** Service principal (API keys, integrations). Pins type='service', userId=null. */
export async function createServicePrincipal(
  params: { role: 'admin' | 'member'; displayName: string; serviceMetadata: ServiceMetadata },
  exec: Executor = db
): Promise<Principal> {
  return createPrincipal(
    {
      type: 'service',
      userId: null,
      role: params.role,
      displayName: params.displayName,
      serviceMetadata: params.serviceMetadata,
    },
    exec
  )
}

// --------------------------------------------------------- role mutation ---

export interface MutateOpts {
  /** Omit -> own write + immediate cache bust. Pass a tx -> write only; caller busts post-commit. */
  executor?: Executor
  /** Preserve an existing WHERE narrowing (e.g. only touch a type='user' row). */
  guards?: { onlyType?: PrincipalType; onlyRole?: Role }
  /** Skip the userId lookup when the caller already has it (keeps a single query). */
  knownUserId?: UserId | null
}

function refWhere(ref: PrincipalRef) {
  return 'principalId' in ref ? eq(principal.id, ref.principalId) : eq(principal.userId, ref.userId)
}

async function resolveUserId(
  ref: PrincipalRef,
  exec: Executor,
  opts: MutateOpts
): Promise<UserId | null> {
  if (opts.knownUserId !== undefined) return opts.knownUserId
  if ('userId' in ref) return ref.userId
  const row = await exec.query.principal.findFirst({
    where: eq(principal.id, ref.principalId),
    columns: { userId: true },
  })
  return row?.userId ?? null
}

export interface SetRoleOpts extends MutateOpts {
  /**
   * Workspace-wide role assignment to write alongside the role column, for
   * callers granting something the legacy mapping can't express (a custom
   * role, the viewer preset). Defaults to the preset for `role`
   * (admin -> Owner, member -> Manager, user -> none). Never pass the Owner or
   * Manager preset here — those ride their matching legacy role, and the seed
   * heal reaps mismatched Owner/Manager rows with no recorded grantor.
   */
  assignRoleId?: RoleId
}

/**
 * The single role-column writer. Also reconciles the principal's workspace-wide
 * assignment rows (see reconcileWorkspaceAssignment). Resolves the owning
 * userId (for cache invalidation) without UPDATE...RETURNING so the existing
 * cache-test mocks stay valid. With no executor it busts immediately; with a tx
 * it writes only and returns the keys for the caller to bust on commit.
 */
export async function setPrincipalRole(
  ref: PrincipalRef,
  role: Role,
  opts: SetRoleOpts = {}
): Promise<{ cacheKeysToBust: readonly string[] }> {
  // The role column and its workspace assignment must move together, and every
  // demotion/removal is serialized through one transaction-scoped lock, so all
  // writes (promotions included) get a transaction when the caller didn't
  // bring one. Keeping this in the sole role writer covers admin UI, SSO/JIT,
  // API-key teardown, and future callers without duplicating a TOCTOU-prone
  // count.
  if (!opts.executor && typeof db.transaction === 'function') {
    const result = await db.transaction((tx) =>
      setPrincipalRole(ref, role, { ...opts, executor: tx })
    )
    for (const key of result.cacheKeysToBust) await cacheDel(key)
    return result
  }

  const exec = opts.executor ?? db
  if (role !== 'admin' && typeof exec.execute === 'function') {
    await exec.execute(sql`SELECT pg_advisory_xact_lock(7061636)`)
    const current = await exec.query.principal.findFirst({ where: refWhere(ref) })
    if (current?.type === 'user' && current.role === 'admin') {
      const [row] = await exec
        .select({ count: sql<number>`count(*)` })
        .from(principal)
        .where(
          and(
            eq(principal.type, 'user'),
            eq(principal.role, 'admin'),
            // Use ne() (not a raw sql fragment) so the id/userId column's
            // TypeID-to-uuid driver mapping is applied; interpolating the
            // branded id string directly makes Postgres reject it as an
            // invalid uuid.
            'principalId' in ref
              ? ne(principal.id, ref.principalId)
              : ne(principal.userId, ref.userId)
          )
        )
      if (Number(row?.count ?? 0) === 0) {
        throw new ForbiddenError('LAST_ADMIN', 'Cannot remove or demote the last admin')
      }
    }
  }
  const conds = [refWhere(ref)]
  if (opts.guards?.onlyType) conds.push(eq(principal.type, opts.guards.onlyType))
  if (opts.guards?.onlyRole) conds.push(eq(principal.role, opts.guards.onlyRole))
  const userId = await resolveUserId(ref, exec, opts)
  const whereClause = conds.length === 1 ? conds[0] : and(...conds)

  // Reconciliation targets the row this UPDATE will actually hit: pre-read it
  // (same guards) under FOR UPDATE so a concurrent role write serializes here
  // and the changed-role check below can't act on a stale snapshot.
  // Capability-gated like the lock above: the real db/tx always has delete;
  // the mocked executors in the unit suites opt out.
  const reconcilable = typeof exec.delete === 'function'
  let target: { id: PrincipalId; role: string } | undefined
  if (reconcilable) {
    ;[target] = await exec
      .select({ id: principal.id, role: principal.role })
      .from(principal)
      .where(whereClause)
      .limit(1)
      .for('update')
  }
  await exec.update(principal).set({ role }).where(whereClause)
  // Reconcile only when the role actually changed or an explicit assignment
  // was requested — a redundant same-role save must not clobber an explicit
  // workspace grant (a custom role) with the legacy preset. A guard-filtered
  // no-op update (no target row) reconciles nothing.
  if (reconcilable && target && (opts.assignRoleId != null || target.role !== role)) {
    await reconcileWorkspaceAssignment(exec, target.id, role, opts.assignRoleId)
  }
  const keys = userId ? [CACHE_KEYS.PRINCIPAL_BY_USER(userId)] : []
  if (!opts.executor) for (const k of keys) await cacheDel(k)
  return { cacheKeysToBust: keys }
}

/**
 * Mirror the legacy role column into principal_role_assignments (workspace-wide
 * rows only; team-scoped grants are never touched). The assignment is what
 * permissionsForPrincipal reads first, so a role write that skipped this would
 * leave the old grant live: a demoted or removed teammate keeping Owner
 * permissions through every requireAuth gate.
 */
async function reconcileWorkspaceAssignment(
  exec: Executor,
  principalId: PrincipalId,
  role: Role,
  assignRoleId?: RoleId
): Promise<void> {
  await exec
    .delete(principalRoleAssignments)
    .where(
      and(
        eq(principalRoleAssignments.principalId, principalId),
        isNull(principalRoleAssignments.teamId)
      )
    )

  let roleId: RoleId | null = assignRoleId ?? null
  if (!roleId) {
    const presetKey = presetForLegacyRole(role)
    if (!presetKey) return
    const [preset] = await exec
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, presetKey))
      .limit(1)
    // No seeded preset row (pre-seed environment): leave zero assignments and
    // let resolution fall back to the legacy preset expansion.
    if (!preset) return
    roleId = preset.id
  }
  await exec.insert(principalRoleAssignments).values({ principalId, roleId }).onConflictDoNothing()
}

// ---------------------------------------------- profile / type mutation ---

/**
 * Write profile and/or type columns. Never touches role, so it stays inert when
 * role assignments land. Only `type` is read by the principal cache, so a
 * profile-only write busts nothing.
 */
export async function updatePrincipalFields(
  ref: PrincipalRef,
  fields: ProfileFields & { type?: PrincipalType },
  opts: MutateOpts = {}
): Promise<{ cacheKeysToBust: readonly string[] }> {
  const exec = opts.executor ?? db
  const conds = [refWhere(ref)]
  if (opts.guards?.onlyType) conds.push(eq(principal.type, opts.guards.onlyType))
  if (opts.guards?.onlyRole) conds.push(eq(principal.role, opts.guards.onlyRole))
  await exec
    .update(principal)
    .set(fields)
    .where(conds.length === 1 ? conds[0] : and(...conds))
  if (fields.type === undefined) return { cacheKeysToBust: [] }
  const userId = await resolveUserId(ref, exec, opts)
  const keys = userId ? [CACHE_KEYS.PRINCIPAL_BY_USER(userId)] : []
  if (!opts.executor) for (const k of keys) await cacheDel(k)
  return { cacheKeysToBust: keys }
}

// -------------------------------------------------------- identity teardown ---

/**
 * Delete a merged or absorbed identity: principal first (it references
 * user_id), then any remaining sessions and the user row. `principalId` is
 * optional because an absorbed signup may never have received a principal.
 *
 * The caller owns re-pointing that principal's activity BEFORE this runs
 * (repointPrincipalActivity in principal-repoint.ts); a missed re-point either
 * aborts here (RESTRICT FKs) or silently cascades content away.
 */
export async function deleteAnonymousIdentity(
  ref: { principalId: PrincipalId | null | undefined; userId: UserId },
  exec: Executor = db
): Promise<void> {
  if (ref.principalId) {
    await exec.delete(principal).where(eq(principal.id, ref.principalId))
  }
  await Promise.all([
    exec.delete(session).where(eq(session.userId, ref.userId)),
    exec.delete(user).where(eq(user.id, ref.userId)),
  ])
}

// -------------------------------------------- back-compat profile wrappers ---

/** Sync profile fields onto a user's principal (WHERE type='user'). Profile-only -> no cache bust. */
export async function syncPrincipalProfile(
  userId: UserId,
  updates: { displayName?: string; avatarUrl?: string | null; avatarKey?: string | null },
  exec: Executor = db
): Promise<void> {
  await updatePrincipalFields({ userId }, updates, { executor: exec, guards: { onlyType: 'user' } })
}

/** Sync profile fields onto a principal addressed by id. */
export async function syncPrincipalProfileById(
  principalId: PrincipalId,
  updates: { displayName?: string; avatarUrl?: string | null; avatarKey?: string | null },
  exec: Executor = db
): Promise<void> {
  await updatePrincipalFields({ principalId }, updates, { executor: exec })
}
