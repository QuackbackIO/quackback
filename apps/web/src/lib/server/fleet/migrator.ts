/**
 * `QUACKBACK_ROLE=migrator` — the fleet migration executor and its reconcile
 * pass (SAAS-HOSTING-STACK.md §10.3).
 *
 * ## Why the executor is the app image
 *
 * The migrations are bundled in `packages/db/drizzle`. If the control plane ran
 * them, version affinity between "which SQL" and "which code" would have to be
 * maintained by hand across two repositories, and the first time they disagreed
 * a tenant would be migrated to a schema no running build knows about. So the
 * CP records intent and this image reconciles toward it.
 *
 * ## Which executor route, and why
 *
 * §10.3 as written was not implementable: it said `runMigrations(connStr)` +
 * `ensureConcurrentIndexes()`, but `ensureConcurrentIndexes` was private to
 * `packages/db/src/migrate.ts` and *that file calls `runMigrations()` at module
 * top level*, so importing it ran migrations as a side effect. The two available
 * routes were to spawn the CLI as a child process, or to export the steps as
 * callable units.
 *
 * **Callable units, in-process.** Three reasons, in order of weight:
 *
 * 1. **The heal and the verification bracket the migration.** Invalid indexes
 *    must be dropped *before* the build and the catalogue swept *after*, and
 *    each step's failure has to be reportable on its own. A child process
 *    offers one exit code and stderr to scrape; distinguishing "the extension
 *    could not be created" from "an index is invalid" would mean parsing log
 *    lines, which is a contract nobody wrote down.
 * 2. **`migrate.ts` calls `process.exit(1)` on failure.** In-process that would
 *    kill the migrator mid-fleet, so the CLI route is not merely inconvenient,
 *    it forces the child-process shape rather than being chosen for it.
 * 3. **Concurrency.** §10.3 wants ~20 tenants at a time; that is 20 Node
 *    processes each re-parsing the whole drizzle schema and re-reading 228 SQL
 *    files. In-process they share one module graph.
 *
 * The cost is honest and worth stating: `packages/db` gained a leaf module
 * (`schema-ops.ts`) and `migrate.ts` became a thin wrapper over the same
 * executor. That is a *reduction* in duplication — the concurrent-index list now
 * exists once and is used by the creator, the heal and the post-condition check.
 *
 * ## The two things the ledger cannot tell you
 *
 * `migrate()` wraps the whole lineage in one transaction, so the lineage is
 * atomic — measured, never partial. **But only `migrate()` is atomic.** The
 * extension creation, the index builds and the seed run outside it, so a kill in
 * the tail leaves a complete ledger and a broken database. Everything this
 * module reports about correctness therefore comes from the catalogue, and
 * `appliedCount` is carried alongside as a diagnostic rather than as evidence.
 *
 * Second: a ledger row is written by drizzle *after it executed the statements*.
 * Nothing here ever inserts one. A tenant whose ledger is behind its own schema
 * — which is the state five live gauntlet databases are in, because they were
 * migrated with `psql -f` — is healed by replaying the SQL, not by asserting
 * that it ran. A wrong ledger row is worse than a missing one.
 */
import postgres from 'postgres'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runMigrations, PooledDsnRefused, type MigrationStep } from '@quackback/db/migrate'
import {
  BUNDLED_MIGRATIONS,
  MIGRATIONS_DIR,
  latestBundledVersion,
  readAppliedLedger,
  type AppliedLedger,
} from '@quackback/db/schema-version'
import { verifySchemaPostconditions, type PostconditionReport } from '@quackback/db'
import { logger } from '@/lib/server/logger'
import {
  assessReplaySafety,
  type ReplaySafetyReport,
} from '@/lib/server/policy/migration-contract/replay-safety'
import {
  listActiveTenants,
  resolveTenantById,
  type TenantDescriptor,
} from '@/lib/server/tenancy/registry'
import { resolveTenantPassword } from '@/lib/server/tenancy/pool-cache'
import { withPassword } from '@/lib/server/tenancy/vendor/secret-ref'
import {
  claimTenants,
  completeTenant,
  ensureSchemaStateRow,
  failTenant,
  heartbeatTenant,
  reapExpiredTenantLeases,
  type ClaimedTenant,
} from './schema-state'

const log = logger.child({ component: 'fleet-migrator' })

export type MigrateTenantCode =
  | 'reconciled'
  | 'already_current'
  | 'refused_replay_mutates'
  | 'refused_pooled_dsn'
  | 'postconditions_violated'
  | 'migration_failed'

export interface MigrateTenantResult {
  tenantId: string
  ok: boolean
  code: MigrateTenantCode
  detail: string
  /** Ledger before the run. */
  before: AppliedLedger
  /** Ledger after the run, absent when nothing was attempted. */
  after: AppliedLedger | null
  /** Bundled tags drizzle would execute, given `before`. */
  replaySet: string[]
  /** Verdicts for those tags. */
  replayVerdicts: ReplaySafetyReport[]
  healedIndexes: string[]
  unhealableIndexes: string[]
  postconditions: PostconditionReport | null
  /** The step reached, so a kill's location is recoverable from the log. */
  lastStep: MigrationStep | 'preflight'
  durationMs: number
}

export interface MigrateTenantOptions {
  /**
   * Proceed even when the replay set contains a migration that would mutate
   * data on a second run. Only ever correct when the operator has established
   * by other means that the ledger is honest for this tenant.
   */
  allowMutatingReplay?: boolean
  /** Skip the concurrent index build. For a dry preflight, never for a rollout. */
  skipConcurrentIndexes?: boolean
  onStep?: (step: MigrationStep) => void
}

/**
 * Which bundled migrations drizzle would execute against this ledger.
 *
 * Read from the driver rather than guessed: `PgDialect.migrate` selects
 * `order by created_at desc limit 1` and applies every bundled entry whose
 * `folderMillis` is **strictly greater** than that one value. So the replay set
 * is a suffix of the journal by `when`, and a gap *below* the high-water mark is
 * never revisited — which is exactly why the compatibility gate checks the whole
 * prefix rather than the maximum.
 */
export function replaySetFor(applied: AppliedLedger): string[] {
  return BUNDLED_MIGRATIONS.filter((e) => e.when > applied.max).map((e) => e.tag)
}

/**
 * May this replay set be run against this ledger?
 *
 * The one dangerous class is `mutates` — a statement that would SUCCEED on a
 * second run and write. A `errors` statement is bounded by the fact that
 * `migrate()` wraps the lineage in one transaction: the run rolls back whole
 * and Postgres's own message is the drift diagnosis. Refusing those too would
 * refuse every ordinary rollout, since 145 of the 228 bundled migrations are
 * plain `CREATE TABLE` / `ADD COLUMN`.
 *
 * **An empty ledger is not a replay.** A fresh database's replay set is the
 * whole lineage starting at `0000_initial`, which includes every mutating
 * migration ever written; there is nothing there to apply twice. Gating on
 * `before.count > 0` is what keeps provisioning working, and it is the
 * condition most likely to be dropped by someone tightening this later.
 */
export function replayGateVerdict(
  before: AppliedLedger,
  verdicts: ReplaySafetyReport[],
  allowMutatingReplay: boolean
): { ok: true } | { ok: false; detail: string } {
  const mutating = verdicts.filter((r) => r.verdict === 'mutates')
  if (mutating.length === 0) return { ok: true }
  if (before.count === 0) return { ok: true }
  if (allowMutatingReplay) return { ok: true }
  return {
    ok: false,
    detail:
      `refusing to migrate: the replay set contains ${mutating.length} migration(s) that would ` +
      'change data if this database has already had them applied outside the ledger. ' +
      mutating.map((m) => `${m.tag} (${m.mutating[0]?.reason ?? 'writes on replay'})`).join('; ') +
      `. This database's ledger records ${before.count} migrations up to ${before.max}. ` +
      'Establish whether those migrations already ran — a Neon branch dry-run is the cheap way ' +
      '(SAAS-HOSTING-STACK.md §10.8) — then re-run with allowMutatingReplay once the ledger is ' +
      'known honest. Do not insert ledger rows by hand: a wrong row is worse than a missing one.',
  }
}

function readMigrationSql(tag: string): string {
  return readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8')
}

/**
 * Migrate one tenant, on its direct endpoint, and verify the result.
 *
 * The connection is built here rather than taken from the pool cache, for two
 * reasons that are both correctness rather than tidiness: the pool cache
 * terminates at the **pooled** endpoint, and `pg_advisory_lock` and
 * `CREATE INDEX CONCURRENTLY` both need session mode; and the pool cache asserts
 * the §3 fingerprint on checkout, which a freshly provisioned database has not
 * been stamped for yet. A migrator that could only run against already-stamped
 * databases could not do the one job provisioning needs it for.
 */
export async function migrateTenant(
  tenant: TenantDescriptor,
  options: MigrateTenantOptions = {}
): Promise<MigrateTenantResult> {
  const started = Date.now()
  let lastStep: MigrationStep | 'preflight' = 'preflight'
  const dsn = withPassword(tenant.database.directUrl, await resolveTenantPassword(tenant))

  const probe = postgres(dsn, { max: 1, onnotice: () => {}, connect_timeout: 20 })
  let before: AppliedLedger
  try {
    before = await readAppliedLedger(probe)
  } finally {
    await probe.end({ timeout: 5 }).catch(() => {})
  }

  const replaySet = replaySetFor(before)
  const replayVerdicts = replaySet.map((tag) => assessReplaySafety(tag, readMigrationSql(tag)))
  const mutating = replayVerdicts.filter((r) => r.verdict === 'mutates')

  const base = {
    tenantId: tenant.tenantId,
    before,
    after: null,
    replaySet,
    replayVerdicts,
    healedIndexes: [],
    unhealableIndexes: [],
    postconditions: null,
    lastStep,
    durationMs: Date.now() - started,
  } satisfies Omit<MigrateTenantResult, 'ok' | 'code' | 'detail'>

  // A cheap pre-check, and its shape is deliberate. If there is nothing to
  // apply AND the catalogue already checks out, the tenant is done and the
  // executor is not run — which matters because the concurrent index builds are
  // ~140 s of round trips against a compute this would otherwise wake for
  // nothing (§10.7).
  //
  // But a complete ledger is NOT on its own a reason to stop. A run killed in
  // the tail leaves exactly that state with an invalid or absent index, so when
  // the post-conditions fail the executor runs anyway: `runMigrations` will
  // drop the invalid indexes, apply nothing (the ledger is complete), rebuild,
  // and verify. An earlier version of this function returned the violation
  // without healing it, which reported the defect and left it in place.
  if (replaySet.length === 0) {
    const early = await withProbe(dsn, (sql) => verifySchemaPostconditions(sql))
    if (early.ok) {
      return {
        ...base,
        after: before,
        postconditions: early,
        ok: true,
        code: 'already_current',
        detail: `ledger complete at ${before.count} migrations; post-conditions verified`,
        durationMs: Date.now() - started,
      }
    }
    log.warn(
      { tenantId: tenant.tenantId, violations: early.violations.map((v) => v.detail) },
      'ledger is complete but the database is not correct — healing'
    )
  }

  const gate = replayGateVerdict(before, replayVerdicts, options.allowMutatingReplay ?? false)
  if (!gate.ok) {
    log.error({ tenantId: tenant.tenantId, mutating: mutating.map((m) => m.tag) }, gate.detail)
    return { ...base, ok: false, code: 'refused_replay_mutates', detail: gate.detail }
  }

  try {
    const result = await runMigrations(dsn, {
      concurrentIndexes: !options.skipConcurrentIndexes,
      onStep: (step) => {
        lastStep = step
        options.onStep?.(step)
      },
    })

    const after = await withProbe(dsn, (sql) => readAppliedLedger(sql))
    const postconditions = result.postconditions

    if (!postconditions || !postconditions.ok) {
      return {
        ...base,
        after,
        lastStep,
        healedIndexes: result.healed.map((i) => i.name),
        unhealableIndexes: result.unhealable.map((i) => i.name),
        postconditions,
        ok: false,
        code: 'postconditions_violated',
        detail:
          `migrations applied (${after.count} ledger rows) but the database is not correct: ` +
          (postconditions?.violations.map((v) => v.detail).join('; ') ?? 'not verified'),
        durationMs: Date.now() - started,
      }
    }

    return {
      ...base,
      after,
      lastStep,
      healedIndexes: result.healed.map((i) => i.name),
      unhealableIndexes: result.unhealable.map((i) => i.name),
      postconditions,
      ok: true,
      code: 'reconciled',
      detail:
        `applied ${replaySet.length} migration(s); ledger ${before.count} -> ${after.count}; ` +
        `${result.healed.length} invalid index(es) healed; post-conditions verified`,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    const code = err instanceof PooledDsnRefused ? 'refused_pooled_dsn' : 'migration_failed'
    const detail = err instanceof Error ? err.message : String(err)
    log.error({ tenantId: tenant.tenantId, step: lastStep, err }, 'tenant migration failed')
    return {
      ...base,
      lastStep,
      ok: false,
      code,
      detail:
        code === 'migration_failed' && before.count > 0
          ? `${detail} — if this reads as "already exists", this database physically carries a ` +
            `migration its ledger does not record. migrate() is transactional, so nothing was ` +
            `applied; the lineage is unchanged.`
          : detail,
      durationMs: Date.now() - started,
    }
  }
}

async function withProbe<T>(dsn: string, body: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(dsn, { max: 1, onnotice: () => {}, connect_timeout: 20 })
  try {
    return await body(sql)
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

export interface ReconcilePassOptions {
  /** Tenants claimed per pass. Bounded and global — §10.3. */
  concurrency?: number
  /** Lease duration. Must exceed the slowest tenant migration; see FLEET-MIGRATIONS.md. */
  leaseMs?: number
  /** Push the lease forward this often while a tenant is migrating. */
  heartbeatMs?: number
  cohort?: string
  tenantId?: string
  workerId: string
  allowMutatingReplay?: boolean
  /** Stop after this many claimed tenants. Unbounded when absent. */
  maxTenants?: number
}

export interface ReconcilePassResult {
  claimed: number
  reconciled: number
  alreadyCurrent: number
  failed: number
  /** Tenants whose registry record the request path would refuse. Never migrated. */
  refusedRecords: number
  reaped: { requeued: number; terminated: number }
  outcomes: MigrateTenantResult[]
}

/**
 * One bounded reconcile pass.
 *
 * Claims through the lease, so two migrator replicas take disjoint tenants and a
 * killed one is reclaimed by the reaper rather than blocking the rollout. The
 * reaper runs first for the same reason the job tier runs it on a timer: an
 * expired lease is the commonest thing standing between a resumed rollout and a
 * stalled one.
 */
export async function runReconcilePass(
  options: ReconcilePassOptions
): Promise<ReconcilePassResult> {
  const concurrency = options.concurrency ?? 4
  const leaseMs = options.leaseMs ?? 15 * 60_000
  const heartbeatMs = options.heartbeatMs ?? Math.floor(leaseMs / 3)

  const reaped = await reapExpiredTenantLeases()

  const { tenants, refused } = await listActiveTenants()
  if (refused.length > 0) {
    log.error({ refused }, 'migrator skipping tenants with invalid registry records')
  }
  const byId = new Map(tenants.map((t) => [t.tenantId, t]))

  const result: ReconcilePassResult = {
    claimed: 0,
    reconciled: 0,
    alreadyCurrent: 0,
    failed: 0,
    refusedRecords: refused.length,
    reaped,
    outcomes: [],
  }

  for (;;) {
    const remaining =
      options.maxTenants === undefined ? concurrency : options.maxTenants - result.claimed
    if (remaining <= 0) break

    const batch = await claimTenants({
      limit: Math.min(concurrency, remaining),
      leaseMs,
      workerId: options.workerId,
      cohort: options.cohort,
      tenantId: options.tenantId,
    })
    if (batch.length === 0) break
    result.claimed += batch.length

    const settled = await Promise.all(
      batch.map((claim) =>
        reconcileClaimed(claim, byId.get(claim.tenantId), {
          heartbeatMs,
          leaseMs,
          allowMutatingReplay: options.allowMutatingReplay,
        })
      )
    )

    for (const outcome of settled) {
      result.outcomes.push(outcome)
      if (!outcome.ok) result.failed += 1
      else if (outcome.code === 'already_current') result.alreadyCurrent += 1
      else result.reconciled += 1
    }
  }

  return result
}

async function reconcileClaimed(
  claim: ClaimedTenant,
  tenant: TenantDescriptor | undefined,
  opts: { heartbeatMs: number; leaseMs: number; allowMutatingReplay?: boolean }
): Promise<MigrateTenantResult> {
  const empty: AppliedLedger = { versions: new Set(), count: 0, max: 0 }
  if (!tenant) {
    const detail =
      `no servable registry record for ${claim.tenantId}. The migrator reads tenants through ` +
      'the same reader the request path uses, so a record the request path would refuse is ' +
      'not migrated either — a half-written record must not become a migrated one.'
    await failTenant(claim, detail)
    return {
      tenantId: claim.tenantId,
      ok: false,
      code: 'migration_failed',
      detail,
      before: empty,
      after: null,
      replaySet: [],
      replayVerdicts: [],
      healedIndexes: [],
      unhealableIndexes: [],
      postconditions: null,
      lastStep: 'preflight',
      durationMs: 0,
    }
  }

  // The heartbeat is created here and cleared in `finally`, so it lives exactly
  // as long as the tenant's migration and can never outlive the lease it is
  // extending.
  const beat = setInterval(() => {
    void heartbeatTenant(claim, opts.leaseMs).then((held) => {
      if (!held) {
        log.error(
          { tenantId: claim.tenantId },
          'migrator lease lost while still migrating — another migrator may now own this tenant'
        )
      }
    })
  }, opts.heartbeatMs)
  beat.unref?.()

  try {
    const outcome = await migrateTenant(tenant, {
      allowMutatingReplay: opts.allowMutatingReplay,
    })
    if (outcome.ok && outcome.after && outcome.after.max < claim.targetVersion) {
      // This image cannot reach the target. Everything it ships has been
      // applied and the database is correct — it is simply an older build than
      // the control plane is asking for. Recording success here would mark the
      // tenant unclaimable at a version no image produced, and the rollout
      // would report complete having skipped it.
      await failTenant(
        claim,
        `this image's newest bundled migration is ${outcome.after.max}, below the target ` +
          `${claim.targetVersion} the control plane recorded. Everything this build ships is ` +
          'applied and verified; deploy the image that carries the target migration.',
        { appliedCount: outcome.after.count, postconditionsOk: true }
      )
      return {
        ...outcome,
        ok: false,
        code: 'migration_failed',
        detail: `image is behind the target (${outcome.after.max} < ${claim.targetVersion})`,
      }
    }
    if (outcome.ok && outcome.after) {
      await completeTenant(claim, {
        version: outcome.after.max,
        appliedCount: outcome.after.count,
        postconditionsOk: outcome.postconditions?.ok ?? false,
      })
    } else {
      await failTenant(claim, `[${outcome.code}] ${outcome.detail}`, {
        appliedCount: outcome.after?.count,
        postconditionsOk: outcome.postconditions?.ok,
      })
    }
    return outcome
  } finally {
    clearInterval(beat)
  }
}

/**
 * Seed intent rows for every active tenant that has none, at the version this
 * build ships.
 *
 * Provisioning and release are the two triggers §10.3 names for one code path.
 * This is the release trigger's half: a tenant that appears in the registry but
 * not in the intent table is invisible to the reconciler, which is the failure
 * mode where a rollout reports "fleet complete" having skipped a tenant nobody
 * enrolled.
 */
export async function enrolActiveTenants(cohort = 'default'): Promise<number> {
  const target = latestBundledVersion()
  const { tenants } = await listActiveTenants()
  let created = 0
  for (const t of tenants) {
    if (await ensureSchemaStateRow({ tenantId: t.tenantId, targetVersion: target, cohort })) {
      created += 1
    }
  }
  return created
}

/**
 * What a run WOULD do, computed by the same functions the run uses.
 *
 * Shares `replaySetFor` and `assessReplaySafety` with {@link migrateTenant}
 * rather than recomputing them, because a preflight that can disagree with the
 * thing it is previewing is worse than no preflight.
 */
export async function planTenant(tenant: TenantDescriptor): Promise<{
  applied: AppliedLedger
  replaySet: string[]
  verdicts: ReplaySafetyReport[]
}> {
  const dsn = withPassword(tenant.database.directUrl, await resolveTenantPassword(tenant))
  const applied = await withProbe(dsn, (sql) => readAppliedLedger(sql))
  const replaySet = replaySetFor(applied)
  return {
    applied,
    replaySet,
    verdicts: replaySet.map((tag) => assessReplaySafety(tag, readMigrationSql(tag))),
  }
}

/** Resolve one tenant for the CLI's single-tenant modes. */
export async function requireTenant(tenantId: string): Promise<TenantDescriptor> {
  const lookup = await resolveTenantById(tenantId)
  if (lookup.kind !== 'ok') {
    throw new Error(
      `tenant ${tenantId} is not servable: ${lookup.kind}` +
        ('problems' in lookup ? ` — ${lookup.problems.join('; ')}` : '')
    )
  }
  return lookup.tenant
}
