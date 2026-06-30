/**
 * Principal factory — the single place that CREATES a principal and the single
 * place that WRITES the principal.role column.
 *
 * Scope: this module owns every principal INSERT and every role write. It does
 * NOT own a small set of cache-safe, column-scoped direct writes other domains
 * make (chat captures `contactEmail` with an overwrite-once guard; presence
 * writes `chatAvailability`) — those columns are never read by the principal
 * role/type cache, so they stay where they are.
 *
 * The role write goes through one private helper (`writeRole`) so that when role
 * assignments arrive (later phases) only that helper changes: `principal.role`
 * becomes a synced projection of the assignment and every call site here stays
 * identical. Every function takes an optional `Executor` so a caller can enlist
 * the write in its own transaction.
 */
import {
  db,
  principal,
  eq,
  and,
  type Principal,
  type ServiceMetadata,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { generateId, type PrincipalId, type UserId } from '@quackback/ids'
import type { Role, PrincipalType } from '@/lib/shared/roles'
import { cacheDel, CACHE_KEYS } from '@/lib/server/redis'

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

/** Insert one brand-new principal. Use only where no concurrent creator can race. */
export async function createPrincipal(
  input: CreatePrincipalInput,
  exec: Executor = db
): Promise<Principal> {
  const [created] = await exec.insert(principal).values(toRow(input)).returning()
  return created
}

/** Insert many brand-new principals in one statement. */
export async function createPrincipals(
  inputs: CreatePrincipalInput[],
  exec: Executor = db
): Promise<Principal[]> {
  if (inputs.length === 0) return []
  return exec.insert(principal).values(inputs.map(toRow)).returning()
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

/**
 * The single role-column writer / later-phase assignment seam. Resolves the
 * owning userId (for cache invalidation) without UPDATE...RETURNING so the
 * existing cache-test mocks stay valid. With no executor it busts immediately;
 * with a tx it writes only and returns the keys for the caller to bust on commit.
 */
export async function setPrincipalRole(
  ref: PrincipalRef,
  role: Role,
  opts: MutateOpts = {}
): Promise<{ cacheKeysToBust: readonly string[] }> {
  const exec = opts.executor ?? db
  const conds = [refWhere(ref)]
  if (opts.guards?.onlyType) conds.push(eq(principal.type, opts.guards.onlyType))
  if (opts.guards?.onlyRole) conds.push(eq(principal.role, opts.guards.onlyRole))
  const userId = await resolveUserId(ref, exec, opts)
  await exec
    .update(principal)
    .set({ role })
    .where(conds.length === 1 ? conds[0] : and(...conds))
  const keys = userId ? [CACHE_KEYS.PRINCIPAL_BY_USER(userId)] : []
  if (!opts.executor) for (const k of keys) await cacheDel(k)
  return { cacheKeysToBust: keys }
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
