/**
 * Where the storage namespace comes from.
 *
 * SAAS-HOSTING-STACK.md §9 states it as a requirement rather than a
 * convention: *the prefix derives from the verified workspace scope, at the same
 * point and from the same source as the database connection, and a key without
 * that prefix must not be expressible.* This module is the first half; the
 * second half is `namespace.ts`, which makes the composition the only door.
 *
 * ## One fact, reached two ways, and neither is a workspaces-mode branch
 *
 * The fact is `settings.id`.
 *
 * - **With a workspace scope**, the value is the one the pool cache already
 *   verified. `evaluateWorkspaceIdentity` compared this database's `settings.id`
 *   against `fingerprint.expectedSelfReportedWorkspaceId` before the scope was ever created,
 *   so reading the expectation off the descriptor is reading the verified value
 *   — no extra query, and no second opinion that could disagree with the check.
 * - **With no scope**, it is read from the one database this process has. That
 *   is the self-hosted install: one process, one database, one workspace, and
 *   `settings.id` is a primary key, so the answer is a process-lifetime
 *   constant.
 *
 * The two are not a `isPooledTenancy()` test wearing a disguise. Neither asks
 * which workspaces mode is configured; both ask the same database the same
 * question, and the difference is only whether the answer was already on hand.
 *
 * ## What an unscoped storage access does, and why it needs no check of its own
 *
 * `currentWorkspaceNamespace()` answers `_` when nothing is scoped. That is right
 * for a cache key and it is wrong for a shared bucket, where `_` is a real,
 * shared prefix that every unscoped caller in the fleet would write into — and
 * the background tier is where that bites, because `exports/` is written by a
 * job with no request scope. So this module never falls back to a literal.
 *
 * What it does instead is ask the database. In a pooled process there is no
 * unscoped database: `db`'s Proxy throws `WorkspaceScopeMissingError` rather than
 * serving a fleet-wide connection, precisely so that §3's failure cannot come
 * back wearing the name of a default. **An unscoped storage access in a pooled
 * process therefore refuses, and it refuses because the database refused** —
 * one mechanism, inherited, rather than a storage-side guard that a later caller
 * could forget to add. A self-hosted process reaches the same line and gets an
 * answer, because there the unscoped database is its own.
 *
 * Note what this deliberately does *not* depend on: nothing here calls
 * `currentWorkspaceNamespace()` to decide a namespace. Its `_` fallback is the
 * thing being replaced, not the thing being guarded, so a change to that
 * function cannot move the namespace out from under storage.
 *
 * ## Why that refusal is only real if this is the only door
 *
 * All of the above describes {@link currentWorkspaceId}. It is worth nothing
 * unless every storage client comes through it, and for one revision that was
 * false: `workspaceStorage()` was exported and guarded instead by comparing its
 * argument against the ambient scope. With no scope there was nothing to compare
 * against, so the guard passed, and an unscoped caller in a pooled process could
 * name any workspace and address the fleet bucket with the fleet credential.
 *
 * The lesson is worth keeping, because the guard read as careful: **a check
 * that is skipped in the state it exists to police is not a weaker version of
 * the control, it is the absence of one.** "No scope" was that state, and the
 * check could not police it, because no scope is also the legitimate state of
 * every self-hosted install. So the repair was structural — the factory stopped
 * being exported, and this function became the only way to obtain a client.
 */
import { fromUuid, type WorkspaceId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import { getWorkspaceScope } from '@/lib/server/workspaces/workspace-context'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'

/**
 * The resolved workspace, memoised per workspace.
 *
 * `settings.id` is a primary key on a singleton row, so this is a constant
 * rather than a cache with a staleness question — the only reason it exists is
 * that the unscoped branch would otherwise issue a query per storage command,
 * and the proxy read path is per asset request.
 *
 * A `WorkspaceKeyedCache` rather than a bare module-level binding, and the reason
 * is the ledger rather than convenience. §4.4's control on module-scope state
 * verifies three of its six categories against the source; the honest category
 * for a bare binding here would have been `refuses-pooled`, which the scanner
 * checks by requiring `isPooledTenancy` in the declaring file — and this file
 * deliberately never asks which workspaces mode is configured. Rather than write a
 * category the scanner cannot check, the state takes the shape the scanner can:
 * partitioned by the active workspace, which is what it needs to be anyway.
 *
 * Note the distinction this relies on and does not blur. `WorkspaceKeyedCache`
 * keys under `_` with no scope, and that is exactly the fallback this module
 * refuses to compose into a bucket. As a **cache key** in one process's heap
 * `_` is correct and is the sanctioned use; as a **bucket prefix** it is a real,
 * shared directory with no owner. Same literal, two different jobs.
 */
const workspaceIds = new WorkspaceKeyedCache<WorkspaceId>(256)
const WORKSPACE_ID_MEMO = 'workspace-id'

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

/**
 * The active scope's workspace, or null outside one. Synchronous, because the
 * value is already on the descriptor.
 *
 * **This function is the vocabulary bridge.** Everything it reads —
 * `getWorkspaceScope()`, `scope.workspace`, `WorkspaceDescriptor` — is the *old* naming;
 * everything it returns and everything downstream of it is `workspace`. If the
 * fleet-wide workspace→workspace rename lands after this, this is the line where
 * the two halves meet, and only the left-hand side moves.
 */
export function scopedWorkspaceId(): WorkspaceId | null {
  // Old vocabulary on the right of the `=`, new vocabulary everywhere below it.
  const scope = getWorkspaceScope()
  if (!scope) return null
  // The registry stores `settings.id` in its UUID spelling, because that is what
  // the fingerprint's SQL compares (`s.id::text`). The branded TypeID is the same
  // value in the spelling the rest of the application uses, and the conversion is
  // a bijection — so the namespace is still exactly the fact that was verified,
  // not a derivative of it.
  const raw = scope.workspace.fingerprint.expectedSelfReportedWorkspaceId
  try {
    return fromUuid('workspace', raw)
  } catch {
    throw new WorkspaceNamespaceUnresolvable(
      `workspace ${scope.workspace.workspaceKey}'s registry record carries workspace id ` +
        `${JSON.stringify(raw)}, which is not a UUID`
    )
  }
}

/**
 * The workspace whose namespace this call must compose into.
 *
 * **The only way a storage client is ever built.** `workspaceStorage()` is not
 * exported, so there is no path to the bucket that skips this function — which
 * matters because this is where the refusal lives. An earlier revision exported
 * the factory behind a scope-equality guard, and that guard skipped its
 * comparison when there was no scope: an unscoped caller in a pooled process
 * could name any workspace and reach the fleet bucket with the fleet credential,
 * because it never came through here and so never read `db`.
 */
export async function currentWorkspaceId(): Promise<WorkspaceId> {
  const memo = workspaceIds.get(WORKSPACE_ID_MEMO)
  if (memo) return memo

  const scoped = scopedWorkspaceId()
  if (scoped) {
    workspaceIds.set(WORKSPACE_ID_MEMO, scoped)
    return scoped
  }

  // No scope. In a pooled process this line throws WorkspaceScopeMissingError from
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
  workspaceIds.set(WORKSPACE_ID_MEMO, row.id)
  return row.id
}
