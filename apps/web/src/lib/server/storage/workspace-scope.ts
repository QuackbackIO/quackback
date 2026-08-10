/**
 * Where the storage namespace comes from.
 *
 * SAAS-HOSTING-STACK.md §9 states it as a requirement rather than a
 * convention: *the prefix derives from the verified tenant scope, at the same
 * point and from the same source as the database connection, and a key without
 * that prefix must not be expressible.* This module is the first half; the
 * second half is `namespace.ts`, which makes the composition the only door.
 *
 * ## One fact, reached two ways, and neither is a tenancy-mode branch
 *
 * The fact is `settings.id`.
 *
 * - **With a tenant scope**, the value is the one the pool cache already
 *   verified. `evaluateTenantIdentity` compared this database's `settings.id`
 *   against `fingerprint.expectedWorkspaceId` before the scope was ever created,
 *   so reading the expectation off the descriptor is reading the verified value
 *   — no extra query, and no second opinion that could disagree with the check.
 * - **With no scope**, it is read from the one database this process has. That
 *   is the self-hosted install: one process, one database, one workspace, and
 *   `settings.id` is a primary key, so the answer is a process-lifetime
 *   constant.
 *
 * The two are not a `isPooledTenancy()` test wearing a disguise. Neither asks
 * which tenancy mode is configured; both ask the same database the same
 * question, and the difference is only whether the answer was already on hand.
 *
 * ## What an unscoped storage access does, and why it needs no check of its own
 *
 * `currentTenantNamespace()` answers `_` when nothing is scoped. That is right
 * for a cache key and it is wrong for a shared bucket, where `_` is a real,
 * shared prefix that every unscoped caller in the fleet would write into — and
 * the background tier is where that bites, because `exports/` is written by a
 * job with no request scope. So this module never falls back to a literal.
 *
 * What it does instead is ask the database. In a pooled process there is no
 * unscoped database: `db`'s Proxy throws `TenantScopeMissingError` rather than
 * serving a fleet-wide connection, precisely so that §3's failure cannot come
 * back wearing the name of a default. **An unscoped storage access in a pooled
 * process therefore refuses, and it refuses because the database refused** —
 * one mechanism, inherited, rather than a storage-side guard that a later caller
 * could forget to add. A self-hosted process reaches the same line and gets an
 * answer, because there the unscoped database is its own.
 *
 * Note what this deliberately does *not* depend on: nothing here calls
 * `currentTenantNamespace()`. Its `_` fallback is the thing being replaced, not
 * the thing being guarded, so a change to that function cannot move the
 * namespace out from under storage.
 */
import { fromUuid, type WorkspaceId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import { getTenantScope } from '@/lib/server/tenancy/tenant-context'

/**
 * The unscoped process's own workspace, memoised for the life of the process.
 *
 * Safe to hold forever and safe to hold un-partitioned: it is only ever
 * populated by the branch that ran with no tenant scope, and that branch cannot
 * complete in a pooled process — the `db` read it depends on throws first. So
 * this can only ever hold the id of a process that serves exactly one workspace.
 */
let unscopedWorkspaceId: WorkspaceId | null = null

/** A process holds a scope but its database will not say who it is. */
export class WorkspaceNamespaceUnresolvable extends Error {
  constructor(detail: string) {
    super(
      `Cannot resolve the storage namespace: ${detail}. Every object name is composed ` +
        `from settings.id, so storage has nothing to address until that is known.`
    )
    this.name = 'WorkspaceNamespaceUnresolvable'
  }
}

/** A client was asked to compose a namespace the active scope does not own. */
export class WorkspaceStorageScopeMismatch extends Error {
  readonly requested: WorkspaceId
  readonly scoped: WorkspaceId
  constructor(requested: WorkspaceId, scoped: WorkspaceId) {
    super(
      `Refusing a storage client for ${requested}: the active tenant scope is ${scoped}. ` +
        `Placement and credentials come from the scope, so this client would compose one ` +
        `workspace's prefix against another workspace's bucket.`
    )
    this.name = 'WorkspaceStorageScopeMismatch'
    this.requested = requested
    this.scoped = scoped
  }
}

/**
 * The active scope's workspace, or null outside one. Synchronous, because the
 * value is already on the descriptor.
 *
 * **This function is the vocabulary bridge.** Everything it reads —
 * `getTenantScope()`, `scope.tenant`, `TenantDescriptor` — is the *old* naming;
 * everything it returns and everything downstream of it is `workspace`. If the
 * fleet-wide tenant→workspace rename lands after this, this is the line where
 * the two halves meet, and only the left-hand side moves.
 */
export function scopedWorkspaceId(): WorkspaceId | null {
  // Old vocabulary on the right of the `=`, new vocabulary everywhere below it.
  const scope = getTenantScope()
  if (!scope) return null
  // The registry stores `settings.id` in its UUID spelling, because that is what
  // the fingerprint's SQL compares (`s.id::text`). The branded TypeID is the same
  // value in the spelling the rest of the application uses, and the conversion is
  // a bijection — so the namespace is still exactly the fact that was verified,
  // not a derivative of it.
  const raw = scope.tenant.fingerprint.expectedWorkspaceId
  try {
    return fromUuid('workspace', raw)
  } catch {
    throw new WorkspaceNamespaceUnresolvable(
      `tenant ${scope.tenant.tenantId}'s registry record carries workspace id ` +
        `${JSON.stringify(raw)}, which is not a UUID`
    )
  }
}

/**
 * Refuse a client whose namespace and whose bucket would come from different
 * tenants.
 *
 * A client's placement and credentials are resolved from the ambient scope, so
 * `workspaceStorage(B)` called inside A's request would compose `t/B/…` against
 * A's bucket with A's credentials — which, in one fleet bucket, is B's objects
 * with no error and no alarm. The check is total exactly where it matters: a
 * second workspace only exists in a pooled process, and in a pooled process any
 * successful resolution came from a scope, because the alternative reads a
 * database that is not there.
 */
export function assertWorkspaceIsInScope(workspaceId: WorkspaceId): void {
  const scoped = scopedWorkspaceId()
  if (scoped !== null && scoped !== workspaceId) {
    throw new WorkspaceStorageScopeMismatch(workspaceId, scoped)
  }
}

/**
 * The workspace whose namespace this call must compose into.
 *
 * The only supported source for the argument to `workspaceStorage()`.
 */
export async function currentWorkspaceId(): Promise<WorkspaceId> {
  const scoped = scopedWorkspaceId()
  if (scoped) return scoped

  if (unscopedWorkspaceId) return unscopedWorkspaceId

  // No scope. In a pooled process this line throws TenantScopeMissingError from
  // the `db` Proxy and never returns — which is the refusal, and it is the
  // database's rather than one of storage's own.
  //
  // `findFirst` with no WHERE, which is the same read §3 cites as proof that
  // `settings` has always been exactly one row per database. If that ever stops
  // being true the fingerprint refuses the pool before this line runs.
  const row = await db.query.settings.findFirst({ columns: { id: true } })
  if (!row?.id) {
    throw new WorkspaceNamespaceUnresolvable('this database has no settings row')
  }
  unscopedWorkspaceId = row.id
  return row.id
}
