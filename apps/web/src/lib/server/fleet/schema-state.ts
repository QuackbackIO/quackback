/**
 * `cp_tenant_schema_state` — the control plane's migration intent, read and
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
 * halfway through a tenant has already spent an attempt, so a tenant whose
 * migration reliably kills the process cannot loop — it exhausts `max_attempts`
 * and goes terminal with a diagnosis. Without that, a poisonous tenant would
 * wake its Neon compute forever, which is the exact cost the architecture exists
 * to avoid.
 *
 * ## The connection
 *
 * The control database is reached through `getControlSql()`, the same tiny,
 * long-lived, non-tenant connection the registry reader uses. It is a direct
 * connection by construction: the control plane is a single always-warm
 * Postgres, not a per-tenant Neon compute behind a transaction pooler.
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
import { getControlSql } from '@/lib/server/tenancy/registry'

const log = logger.child({ component: 'fleet-schema-state' })

export const SCHEMA_STATE_TABLE = 'cp_tenant_schema_state'

/**
 * A drizzle handle over the control connection.
 *
 * Built lazily and memoised: `getControlSql()` throws when
 * `QUACKBACK_CONTROL_DATABASE_URL` is unset, and a module-level call would make
 * importing this file fail on a single-tenant install that will never use it.
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

export interface ClaimedTenant extends LeaseHandle {
  tenantId: string
  targetVersion: number
  currentVersion: number | null
  cohort: string
  attempts: number
  maxAttempts: number
  lockedUntil: Date
}

interface ClaimRow {
  id: string | number | bigint
  tenant_id: string
  target_version: string | number
  current_version: string | number | null
  cohort: string
  attempts: number
  max_attempts: number
  lease_token: string
  locked_until: Date | string
}

export interface ClaimTenantsInput {
  limit: number
  leaseMs: number
  workerId: string
  /** Restrict to one rollout cohort. Omitted means every cohort. */
  cohort?: string
  /** Restrict to one tenant. Used by the CLI's single-tenant mode. */
  tenantId?: string
}

/**
 * Claim up to `limit` tenants that are behind their target.
 *
 * The extra predicate is the only thing this adds to the shared claim: a row
 * whose `current_version` already meets `target_version` is not claimable, so a
 * reconciler pass over an already-reconciled fleet costs one query and wakes no
 * tenant computes. That matters — §10.7's whole point is that eagerly migrating
 * the fleet wakes every suspended Neon compute.
 */
export async function claimTenants(input: ClaimTenantsInput): Promise<ClaimedTenant[]> {
  if (input.limit < 1) return []

  const filters = [
    sql`(current_version IS NULL OR current_version < target_version)`,
    input.cohort ? sql`cohort = ${input.cohort}` : null,
    input.tenantId ? sql`tenant_id = ${input.tenantId}` : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null)

  const where = filters.reduce((acc, f, i) => (i === 0 ? f : sql`${acc} AND ${f}`))

  const result = await controlDb().execute(
    leaseClaimSql({
      table: SCHEMA_STATE_TABLE,
      where,
      limit: input.limit,
      leaseMs: input.leaseMs,
      workerId: input.workerId,
      returning: sql`j.id, j.tenant_id, j.target_version, j.current_version, j.cohort,
                     j.attempts, j.max_attempts, j.lease_token, j.locked_until`,
    })
  )

  return getExecuteRows<ClaimRow>(result).map((row) => ({
    id: String(row.id),
    tenantId: row.tenant_id,
    targetVersion: Number(row.target_version),
    currentVersion: row.current_version === null ? null : Number(row.current_version),
    cohort: row.cohort,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseToken: row.lease_token,
    lockedUntil: row.locked_until instanceof Date ? row.locked_until : new Date(row.locked_until),
  }))
}

/** Push the lease forward while a tenant is still migrating. False = lease lost. */
export async function heartbeatTenant(handle: LeaseHandle, leaseMs: number): Promise<boolean> {
  const result = await controlDb().execute(leaseHeartbeatSql(SCHEMA_STATE_TABLE, handle, leaseMs))
  return getExecuteRows(result).length > 0
}

export interface ObservedSchema {
  /** Newest applied journal `when` observed in the tenant database. */
  version: number
  /** Ledger row count. Diagnostic only — see the column comment. */
  appliedCount: number
  /** Catalogue-verified, never derived from the ledger. */
  postconditionsOk: boolean
}

/**
 * Record a reconciled tenant.
 *
 * Two things it refuses, both mirrored by database `CHECK`s so a hand-run
 * `UPDATE` during an incident cannot get past them either:
 *
 * - **Success without a verified post-condition verdict.** A tenant whose
 *   migrations all applied and whose indexes are invalid is not reconciled.
 * - **Success below the target.** A migrator whose bundle is older than the
 *   version the control plane asked for would otherwise apply everything it
 *   has, observe a lower version, and record `succeeded` — and the row would
 *   then be *unclaimable*, because the claim narrows on
 *   `current_version < target_version`. The rollout would report complete
 *   having silently skipped the tenant.
 */
export async function completeTenant(
  handle: LeaseHandle,
  observed: ObservedSchema
): Promise<boolean> {
  if (!observed.postconditionsOk) {
    throw new Error(
      'completeTenant called with failing post-conditions. A complete migration ledger is ' +
        'not evidence that the database is correct; report this through failTenant so the ' +
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
 * operator can read next to "this tenant failed" is what its schema actually
 * looked like when it did.
 */
export async function failTenant(
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
export async function reapExpiredTenantLeases(): Promise<ReapResult> {
  const result = await controlDb().execute(leaseReapSql(SCHEMA_STATE_TABLE, sql`j.tenant_id`))
  const rows = getExecuteRows<{
    tenant_id: string
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
        { tenantId: row.tenant_id, attempts: row.attempts, lostBy: row.locked_by },
        'migrator lease expired; tenant requeued'
      )
    } else {
      out.terminated += 1
      log.error(
        { tenantId: row.tenant_id, attempts: row.attempts, lostBy: row.locked_by },
        'migrator lease expired with no attempts remaining — tenant failed terminally'
      )
    }
  }
  return out
}

export interface SchemaStateRow {
  tenantId: string
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
    SELECT tenant_id, target_version, current_version, applied_count, postconditions_ok,
           cohort, status::text AS status, attempts, max_attempts, last_error,
           locked_by, locked_until, last_verified_at
      FROM ${sql.identifier(SCHEMA_STATE_TABLE)}
     ${cohort ? sql`WHERE cohort = ${cohort}` : sql``}
     ORDER BY tenant_id
  `)
  return getExecuteRows<Record<string, unknown>>(result).map((r) => ({
    tenantId: String(r.tenant_id),
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
 * Write intent: what version this cohort of tenants should reach.
 *
 * This is the control plane's half of the contract and it is deliberately the
 * only writer of `target_version`. Resetting `status` to `pending` here is what
 * makes a rollout resumable after a terminal failure — an operator raising the
 * target is asserting that the previous diagnosis has been addressed, which is
 * exactly the moment it is legitimate to clear it.
 *
 * **`blocked` is preserved, alongside `running`.** An earlier version reset it,
 * which meant a routine target bump silently un-halted a tenant somebody had
 * deliberately taken out of the rollout — and cleared the reason they recorded
 * for doing it. A block is a human decision and only a human should lift it
 * (`fleet-migrator block` / an explicit status change), so it survives every
 * write on this path. Found while guarding a fixture against exactly this.
 */
export async function setTargetVersion(input: {
  targetVersion: number
  tenantIds?: string[]
  cohort?: string
}): Promise<number> {
  const scope = input.tenantIds
    ? sql`tenant_id = ANY(${sql.raw(`ARRAY[${input.tenantIds.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]::text[]`)})`
    : input.cohort
      ? sql`cohort = ${input.cohort}`
      : sql`true`

  const result = await controlDb().execute(sql`
    UPDATE ${sql.identifier(SCHEMA_STATE_TABLE)}
    SET target_version = ${input.targetVersion},
        -- Only a tenant that is actually BEHIND the new target goes back to
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
    RETURNING tenant_id
  `)
  return getExecuteRows(result).length
}

/**
 * Create the intent row for a tenant that does not have one.
 *
 * Idempotent, and never lowers an existing target: a tenant that already has a
 * row is under the control plane's management and this must not quietly reset
 * a rollout that is in flight.
 */
export async function ensureSchemaStateRow(input: {
  tenantId: string
  targetVersion: number
  cohort?: string
  maxAttempts?: number
}): Promise<boolean> {
  const result = await controlDb().execute(sql`
    INSERT INTO ${sql.identifier(SCHEMA_STATE_TABLE)}
      (tenant_id, target_version, cohort, max_attempts)
    VALUES (${input.tenantId}, ${input.targetVersion}, ${input.cohort ?? 'default'},
            ${input.maxAttempts ?? 3})
    ON CONFLICT (tenant_id) DO NOTHING
    RETURNING tenant_id
  `)
  return getExecuteRows(result).length > 0
}

/** Take a tenant out of claiming entirely — a halted rollout, an investigation. */
export async function blockTenant(tenantId: string, reason: string): Promise<boolean> {
  const result = await controlDb().execute(sql`
    UPDATE ${sql.identifier(SCHEMA_STATE_TABLE)}
    SET status = 'blocked', last_error = ${reason},
        lease_token = NULL, locked_until = NULL, locked_by = NULL
    WHERE tenant_id = ${tenantId} AND status <> 'running'
    RETURNING tenant_id
  `)
  return getExecuteRows(result).length > 0
}
