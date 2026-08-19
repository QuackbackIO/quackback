/**
 * `cp_workspace_schema_state` — the control plane's migration intent, read and
 * written by the app (SAAS-HOSTING-STACK.md §10.3).
 *
 * The direction of the arrows is the whole design: **the control plane records
 * intent; the app reconciles toward it.** The CP writes `target_version` and
 * `cohort` and never touches anything else; the migrator claims a row, does the
 * work, and writes back only what it *observed*. Neither side writes the
 * other's columns, so "what should happen" and "what did happen" cannot be
 * confused for one another during an incident.
 *
 * ## Why claiming is not a new mechanism
 *
 * Every statement below comes from `jobs/lease.ts`, which is the primitive the
 * Postgres job queue already uses — 70 SIGKILLs at random instants, 4 concurrent
 * reapers against 4 concurrent drainers, zero double executions, with a positive
 * control proving the harness can see a double. §10.3 says fleet migration is
 * *"its second consumer, not a new subsystem"*, and this module is what makes
 * that true at the level of the SQL rather than at the level of the prose.
 *
 * The one property worth restating here because it matters more for migration
 * than for jobs: **`attempts` is incremented by the CLAIM.** A migrator killed
 * halfway through a workspace has already spent an attempt, so a workspace whose
 * migration reliably kills the process cannot loop — it exhausts `max_attempts`
 * and goes terminal with a diagnosis. Without that, a poisonous workspace would
 * wake its workspace database forever, which is the exact cost the architecture exists
 * to avoid.
 *
 * ## The connection
 *
 * The control database is reached through `getControlSql()`, the same tiny,
 * long-lived, non-workspace connection the registry reader uses. It is a direct
 * connection by construction: the control plane is a single always-warm
 * Postgres, not a per-workspace compute behind a transaction pooler.
 */
import { sql } from 'drizzle-orm'
import { createDbFromSql, type Database } from '@quackback/db/client'
import { logger } from '@/lib/server/logger'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import {
  leaseClaimSql,
  leaseCompleteSql,
  leaseFailSql,
  leaseHeartbeatSql,
  leaseReapSql,
  type LeaseHandle,
} from '@/lib/server/jobs/lease'
import { getControlSql } from '@/lib/server/workspaces/registry'

const log = logger.child({ component: 'fleet-schema-state' })

export const SCHEMA_STATE_TABLE = 'cp_workspace_schema_state'

/**
 * A drizzle handle over the control connection.
 *
 * Built lazily and memoised: `getControlSql()` throws when
 * `QUACKBACK_CONTROL_DATABASE_URL` is unset, and a module-level call would make
 * importing this file fail on a single-workspace install that will never use it.
 */
let controlDbMemo: Database | null = null
export function controlDb(): Database {
  if (!controlDbMemo) controlDbMemo = createDbFromSql(getControlSql())
  return controlDbMemo
}

/** Test seam — swap the control handle without touching config. */
export function __setControlDbForTests(db: Database | null): void {
  controlDbMemo = db
}

export type SchemaStateStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked'

export interface ClaimedWorkspace extends LeaseHandle {
  workspaceKey: string
  targetVersion: number
  currentVersion: number | null
  cohort: string
  attempts: number
  maxAttempts: number
  lockedUntil: Date
}

interface ClaimRow {
  id: string | number | bigint
  workspace_key: string
  target_version: string | number
  current_version: string | number | null
  cohort: string
  attempts: number
  max_attempts: number
  lease_token: string
  locked_until: Date | string
}

export interface ClaimWorkspacesInput {
  limit: number
  leaseMs: number
  workerId: string
  /** Restrict to one rollout cohort. Omitted means every cohort. */
  cohort?: string
  /** Restrict to one workspace. Used by the CLI's single-workspace mode. */
  workspaceKey?: string
}

/**
 * Claim up to `limit` workspaces that are behind their target.
 *
 * The extra predicate is the only thing this adds to the shared claim: a row
 * whose `current_version` already meets `target_version` is not claimable, so a
 * reconciler pass over an already-reconciled fleet costs one query and wakes no
 * workspace computes. That matters — §10.7's whole point is that eagerly migrating
 * the fleet wakes every suspended workspace database.
 */
export async function claimWorkspaces(input: ClaimWorkspacesInput): Promise<ClaimedWorkspace[]> {
  if (input.limit < 1) return []

  const filters = [
    sql`(current_version IS NULL OR current_version < target_version)`,
    input.cohort ? sql`cohort = ${input.cohort}` : null,
    input.workspaceKey ? sql`workspace_key = ${input.workspaceKey}` : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null)

  const where = filters.reduce((acc, f, i) => (i === 0 ? f : sql`${acc} AND ${f}`))

  const result = await controlDb().execute(
    leaseClaimSql({
      table: SCHEMA_STATE_TABLE,
      where,
      limit: input.limit,
      leaseMs: input.leaseMs,
      workerId: input.workerId,
      returning: sql`j.id, j.workspace_key, j.target_version, j.current_version, j.cohort,
                     j.attempts, j.max_attempts, j.lease_token, j.locked_until`,
    })
  )

  return getExecuteRows<ClaimRow>(result).map((row) => ({
    id: String(row.id),
    workspaceKey: row.workspace_key,
    targetVersion: Number(row.target_version),
    currentVersion: row.current_version === null ? null : Number(row.current_version),
    cohort: row.cohort,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseToken: row.lease_token,
    lockedUntil: row.locked_until instanceof Date ? row.locked_until : new Date(row.locked_until),
  }))
}

/** Push the lease forward while a workspace is still migrating. False = lease lost. */
export async function heartbeatWorkspace(handle: LeaseHandle, leaseMs: number): Promise<boolean> {
  const result = await controlDb().execute(leaseHeartbeatSql(SCHEMA_STATE_TABLE, handle, leaseMs))
  return getExecuteRows(result).length > 0
}

export interface ObservedSchema {
  /** Newest applied journal `when` observed in the workspace database. */
  version: number
  /** Ledger row count. Diagnostic only — see the column comment. */
  appliedCount: number
  /** Catalogue-verified, never derived from the ledger. */
  postconditionsOk: boolean
}

/**
 * Record a reconciled workspace.
 *
 * Two things it refuses, both mirrored by database `CHECK`s so a hand-run
 * `UPDATE` during an incident cannot get past them either:
 *
 * - **Success without a verified post-condition verdict.** A workspace whose
 *   migrations all applied and whose indexes are invalid is not reconciled.
 * - **Success below the target.** A migrator whose bundle is older than the
 *   version the control plane asked for would otherwise apply everything it
 *   has, observe a lower version, and record `succeeded` — and the row would
 *   then be *unclaimable*, because the claim narrows on
 *   `current_version < target_version`. The rollout would report complete
 *   having silently skipped the workspace.
 */
export async function completeWorkspace(
  handle: LeaseHandle,
  observed: ObservedSchema
): Promise<boolean> {
  if (!observed.postconditionsOk) {
    throw new Error(
      'completeWorkspace called with failing post-conditions. A complete migration ledger is ' +
        'not evidence that the database is correct; report this through failWorkspace so the ' +
        'diagnosis survives.'
    )
  }
  const result = await controlDb().execute(sql`
    UPDATE ${sql.identifier(SCHEMA_STATE_TABLE)}
    SET current_version = ${observed.version},
        applied_count = ${observed.appliedCount},
        postconditions_ok = true,
        last_verified_at = now()
    WHERE id = ${handle.id}::bigint AND lease_token = ${handle.leaseToken}::uuid AND status = 'running'
      AND target_version <= ${observed.version}
    RETURNING id
  `)
  if (getExecuteRows(result).length === 0) return false
  const done = await controlDb().execute(leaseCompleteSql(SCHEMA_STATE_TABLE, handle))
  return getExecuteRows(done).length > 0
}

export type FailOutcome = 'retrying' | 'failed' | 'lease-lost'

/**
 * Record a failed reconcile.
 *
 * `observed` is written even on failure, because the most useful thing an
 * operator can read next to "this workspace failed" is what its schema actually
 * looked like when it did.
 */
export async function failWorkspace(
  handle: LeaseHandle,
  message: string,
  observed?: Partial<ObservedSchema>,
  backoffMs = 30_000
): Promise<FailOutcome> {
  if (observed) {
    await controlDb().execute(sql`
      UPDATE ${sql.identifier(SCHEMA_STATE_TABLE)}
      SET applied_count = COALESCE(${observed.appliedCount ?? null}, applied_count),
          postconditions_ok = COALESCE(${observed.postconditionsOk ?? null}, postconditions_ok),
          last_verified_at = now()
      WHERE id = ${handle.id}::bigint AND lease_token = ${handle.leaseToken}::uuid AND status = 'running'
    `)
  }
  const result = await controlDb().execute(
    leaseFailSql(SCHEMA_STATE_TABLE, handle, message, { backoffMs })
  )
  const rows = getExecuteRows<{ status: string }>(result)
  if (rows.length === 0) return 'lease-lost'
  return rows[0]!.status === 'pending' ? 'retrying' : 'failed'
}

export interface ReapResult {
  requeued: number
  terminated: number
}

/** Reclaim leases whose migrator died. Same statement the job queue's reaper uses. */
export async function reapExpiredWorkspaceLeases(): Promise<ReapResult> {
  const result = await controlDb().execute(leaseReapSql(SCHEMA_STATE_TABLE, sql`j.workspace_key`))
  const rows = getExecuteRows<{
    workspace_key: string
    status: string
    attempts: number
    max_attempts: number
    locked_by: string | null
  }>(result)

  const out: ReapResult = { requeued: 0, terminated: 0 }
  for (const row of rows) {
    if (row.status === 'pending') {
      out.requeued += 1
      log.warn(
        { workspaceKey: row.workspace_key, attempts: row.attempts, lostBy: row.locked_by },
        'migrator lease expired; workspace requeued'
      )
    } else {
      out.terminated += 1
      log.error(
        { workspaceKey: row.workspace_key, attempts: row.attempts, lostBy: row.locked_by },
        'migrator lease expired with no attempts remaining — workspace failed terminally'
      )
    }
  }
  return out
}

export interface SchemaStateRow {
  workspaceKey: string
  targetVersion: number
  currentVersion: number | null
  appliedCount: number | null
  postconditionsOk: boolean | null
  cohort: string
  status: SchemaStateStatus
  attempts: number
  maxAttempts: number
  lastError: string | null
  lockedBy: string | null
  lockedUntil: Date | null
  lastVerifiedAt: Date | null
}

/** Read the whole table, for the CLI's status view and the CP's rollout page. */
export async function listSchemaState(cohort?: string): Promise<SchemaStateRow[]> {
  const result = await controlDb().execute(sql`
    SELECT workspace_key, target_version, current_version, applied_count, postconditions_ok,
           cohort, status::text AS status, attempts, max_attempts, last_error,
           locked_by, locked_until, last_verified_at
      FROM ${sql.identifier(SCHEMA_STATE_TABLE)}
     ${cohort ? sql`WHERE cohort = ${cohort}` : sql``}
     ORDER BY workspace_key
  `)
  return getExecuteRows<Record<string, unknown>>(result).map((r) => ({
    workspaceKey: String(r.workspace_key),
    targetVersion: Number(r.target_version),
    currentVersion: r.current_version === null ? null : Number(r.current_version),
    appliedCount: r.applied_count === null ? null : Number(r.applied_count),
    postconditionsOk: r.postconditions_ok as boolean | null,
    cohort: String(r.cohort),
    status: r.status as SchemaStateStatus,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    lastError: (r.last_error as string | null) ?? null,
    lockedBy: (r.locked_by as string | null) ?? null,
    lockedUntil: r.locked_until ? new Date(r.locked_until as string) : null,
    lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at as string) : null,
  }))
}

/**
 * Write intent: what version this cohort of workspaces should reach.
 *
 * This is the control plane's half of the contract and it is deliberately the
 * only writer of `target_version`. Resetting `status` to `pending` here is what
 * makes a rollout resumable after a terminal failure — an operator raising the
 * target is asserting that the previous diagnosis has been addressed, which is
 * exactly the moment it is legitimate to clear it.
 *
 * **`blocked` is preserved, alongside `running`.** An earlier version reset it,
 * which meant a routine target bump silently un-halted a workspace somebody had
 * deliberately taken out of the rollout — and cleared the reason they recorded
 * for doing it. A block is a human decision and only a human should lift it
 * (`fleet-migrator block` / an explicit status change), so it survives every
 * write on this path. Found while guarding a fixture against exactly this.
 */
export async function setTargetVersion(input: {
  targetVersion: number
  workspaceKeys?: string[]
  cohort?: string
}): Promise<number> {
  const scope = input.workspaceKeys
    ? sql`workspace_key = ANY(${sql.raw(`ARRAY[${input.workspaceKeys.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]::text[]`)})`
    : input.cohort
      ? sql`cohort = ${input.cohort}`
      : sql`true`

  const result = await controlDb().execute(sql`
    UPDATE ${sql.identifier(SCHEMA_STATE_TABLE)}
    SET target_version = ${input.targetVersion},
        -- Only a workspace that is actually BEHIND the new target goes back to
        -- pending. Resetting unconditionally left a fleet reading "10 pending"
        -- when every one of them was already at the target and none was
        -- claimable: the claim narrows on current_version < target_version, so
        -- correctness held while the status column lied to the operator reading
        -- it during a rollout.
        status = CASE
                   WHEN status IN ('running', 'blocked') THEN status
                   WHEN current_version IS NOT NULL
                        AND current_version >= ${input.targetVersion} THEN status
                   ELSE 'pending'
                 END,
        attempts = CASE
                     WHEN status IN ('running', 'blocked') THEN attempts
                     WHEN current_version IS NOT NULL
                          AND current_version >= ${input.targetVersion} THEN attempts
                     ELSE 0
                   END,
        run_at = now(),
        last_error = CASE
                       WHEN status = 'blocked' THEN last_error
                       WHEN current_version IS NOT NULL
                            AND current_version >= ${input.targetVersion} THEN last_error
                       ELSE NULL
                     END
    WHERE ${scope}
    RETURNING workspace_key
  `)
  return getExecuteRows(result).length
}

/**
 * Create the intent row for a workspace that does not have one.
 *
 * Idempotent, and never lowers an existing target: a workspace that already has a
 * row is under the control plane's management and this must not quietly reset
 * a rollout that is in flight.
 */
export async function ensureSchemaStateRow(input: {
  workspaceKey: string
  targetVersion: number
  cohort?: string
  maxAttempts?: number
}): Promise<boolean> {
  const result = await controlDb().execute(sql`
    INSERT INTO ${sql.identifier(SCHEMA_STATE_TABLE)}
      (workspace_key, target_version, cohort, max_attempts)
    VALUES (${input.workspaceKey}, ${input.targetVersion}, ${input.cohort ?? 'default'},
            ${input.maxAttempts ?? 3})
    ON CONFLICT (workspace_key) DO NOTHING
    RETURNING workspace_key
  `)
  return getExecuteRows(result).length > 0
}

/**
 * Why a named workspace was not claimed.
 *
 * `run --workspace X` claiming nothing is ambiguous in a way that matters: it
 * happens when the workspace is already current (success), when it is blocked
 * (deliberate), when another migrator holds it (transient), and when nobody
 * ever enrolled it (a real gap). Reporting `claimed=0` and exiting 0 for all
 * four turns *"migrate this workspace now"* — which is what provisioning calls —
 * into a silent, successful-looking no-op.
 *
 * Read AFTER a claim attempt returns nothing, so it explains a fact rather than
 * predicting one; a pre-check would race the claim it is describing.
 */
export type UnclaimedReason =
  | { kind: 'no_intent_row'; detail: string }
  | { kind: 'blocked'; detail: string }
  | { kind: 'already_current'; detail: string }
  | { kind: 'held_by_another'; detail: string }
  | { kind: 'terminal'; detail: string }
  | { kind: 'not_due'; detail: string }
  | { kind: 'unknown'; detail: string }

export async function explainUnclaimed(workspaceKey: string): Promise<UnclaimedReason> {
  const rows = await listSchemaState()
  const row = rows.find((r) => r.workspaceKey === workspaceKey)
  if (!row) {
    return {
      kind: 'no_intent_row',
      detail:
        `${workspaceKey} has no row in ${SCHEMA_STATE_TABLE}, so the reconciler cannot see it. ` +
        'Run `enrol` (fleet-wide) or insert intent for this workspace. Note that a workspace absent ' +
        'from this table is invisible to a rollout, which is how "fleet complete" gets reported ' +
        'having skipped one.',
    }
  }
  if (row.status === 'blocked') {
    return {
      kind: 'blocked',
      detail:
        `${workspaceKey} is blocked and will not be claimed by anything: ` +
        `${row.lastError ?? '(no reason recorded)'}. Lift it deliberately; a target bump ` +
        'will not.',
    }
  }
  if (row.status === 'running') {
    return {
      kind: 'held_by_another',
      detail:
        `${workspaceKey} is leased by ${row.lockedBy ?? 'another migrator'} until ` +
        `${row.lockedUntil?.toISOString() ?? 'unknown'}. Wait for it, or for the reaper.`,
    }
  }
  if (row.currentVersion !== null && row.currentVersion >= row.targetVersion) {
    return {
      kind: 'already_current',
      detail: `${workspaceKey} is already at its target (${row.targetVersion}); nothing to do.`,
    }
  }
  if (row.status === 'failed') {
    return {
      kind: 'terminal',
      detail:
        `${workspaceKey} has exhausted its attempts (${row.attempts}/${row.maxAttempts}) and is ` +
        `terminal: ${row.lastError ?? '(no reason recorded)'}. Raise the target, or fix the ` +
        'cause; it will not be retried on its own.',
    }
  }
  return {
    kind: 'not_due',
    detail:
      `${workspaceKey} is ${row.status} but was not claimable on this pass — most likely its ` +
      'run_at is in the future after a backoff. Retry shortly.',
  }
}

/** Take a workspace out of claiming entirely — a halted rollout, an investigation. */
export async function blockWorkspace(workspaceKey: string, reason: string): Promise<boolean> {
  const result = await controlDb().execute(sql`
    UPDATE ${sql.identifier(SCHEMA_STATE_TABLE)}
    SET status = 'blocked', last_error = ${reason},
        lease_token = NULL, locked_until = NULL, locked_by = NULL
    WHERE workspace_key = ${workspaceKey} AND status <> 'running'
    RETURNING workspace_key
  `)
  return getExecuteRows(result).length > 0
}
