/**
 * `QUACKBACK_ROLE=migrator` — the fleet migration executor and its reconcile
 * pass (SAAS-HOSTING-STACK.md §10.3).
 *
 * ## Why the executor is the app image
 *
 * The migrations are bundled in `packages/db/drizzle`. If the control plane ran
 * them, version affinity between "which SQL" and "which code" would have to be
 * maintained by hand across two repositories, and the first time they disagreed
 * a workspace would be migrated to a schema no running build knows about. So the
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
 * 3. **Concurrency.** §10.3 wants ~20 workspaces at a time; that is 20 Node
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
 * Nothing here ever inserts one. A workspace whose ledger is behind its own schema
 * — which is the state five live fleet databases are in, because they were
 * migrated with `psql -f` — is healed by replaying the SQL, not by asserting
 * that it ran. A wrong ledger row is worse than a missing one.
 *
 * ## Gaps, and the division of labour that used to leave them stuck
 *
 * Drizzle applies every bundled entry above `max(created_at)` and never looks
 * below it, so a ledger with a *hole* is invisible to the migrator while being
 * exactly what the compatibility gate refuses. That split — the reconciler
 * advances the tip, the gate detects holes — has a dead end in it, because the
 * gate can only refuse. Measured on two live workspaces: high-water at `0253` with
 * rows absent for `0249`, `0250`, `0251` and `0252`, `settings.cloud`
 * physically missing, every page 500ing, and both instruments reporting fine —
 * the reconciler `OK [reconciled] post=true`, having applied two migrations and
 * healed nothing.
 *
 * {@link ledgerGapFor} finds the hole and {@link gapHealVerdict} decides whether
 * it may be closed; the close itself is a DELETE and nothing else. The direction
 * is the safety argument: a DELETE can only make the ledger claim *less*, every
 * surviving row is still drizzle's own evidence, and the rows that come back are
 * written by drizzle after it has run the SQL again. Under-claiming is the
 * recoverable direction — a ledger describing less than its database is replayed
 * forward; one describing more is a false answer nothing can detect.
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
  tagForVersion,
  truncateAppliedLedger,
  type AppliedLedger,
} from '@quackback/db/schema-version'
import { verifySchemaPostconditions, type PostconditionReport } from '@quackback/db'
import { logger } from '@/lib/server/logger'
import {
  assessReplaySafety,
  type ReplaySafetyReport,
} from '@/lib/server/policy/migration-contract/replay-safety'
import {
  listActiveWorkspaces,
  resolveWorkspaceById,
  type WorkspaceDescriptor,
} from '@/lib/server/workspaces/registry'
import { resolveWorkspacePassword } from '@/lib/server/workspaces/pool-cache'
import { withPassword } from '@/lib/server/workspaces/vendor/secret-ref'
import {
  claimWorkspaces,
  completeWorkspace,
  ensureSchemaStateRow,
  failWorkspace,
  heartbeatWorkspace,
  reapExpiredWorkspaceLeases,
  type ClaimedWorkspace,
} from './schema-state'

const log = logger.child({ component: 'fleet-migrator' })

export type MigrateWorkspaceCode =
  | 'reconciled'
  | 'healed_ledger_gap'
  | 'already_current'
  | 'refused_replay_mutates'
  | 'refused_ledger_gap'
  | 'refused_pooled_dsn'
  | 'postconditions_violated'
  | 'migration_failed'

export interface MigrateWorkspaceResult {
  workspaceKey: string
  ok: boolean
  code: MigrateWorkspaceCode
  detail: string
  /** Ledger before the run. */
  before: AppliedLedger
  /** Ledger after the run, absent when nothing was attempted. */
  after: AppliedLedger | null
  /** Null when `before` records an unbroken prefix of the bundled journal. */
  gap: LedgerGap | null
  /**
   * Bundled tags this run would execute — after its ledger truncation, when
   * there is a gap. Not `replaySetFor(before)`, which on a gapped ledger reports
   * a short tail and hides the hole.
   */
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

export interface MigrateWorkspaceOptions {
  /**
   * Proceed even when the replay set contains a migration that would mutate
   * data on a second run. Only ever correct when the operator has established
   * by other means that the ledger is honest for this workspace.
   */
  allowMutatingReplay?: boolean
  /** Skip the concurrent index build. For a dry preflight, never for a rollout. */
  skipConcurrentIndexes?: boolean
  /** Override {@link DEFAULT_MIGRATE_LOCK_TIMEOUT_MS}. */
  lockTimeoutMs?: number
  onStep?: (step: MigrationStep) => void
}

/**
 * How long the lineage will wait for a table lock before giving up.
 *
 * Set here rather than left off, because the migrator runs against workspaces whose
 * worker tier is live. `0250_job_queue` needs ACCESS EXCLUSIVE on `job_queue` to
 * replace its wake trigger, and the job poller holds ROW EXCLUSIVE on that table
 * more or less continuously — measured against the live fleet, that pair
 * deadlocks rather than queues, because the migration transaction is upgrading a
 * lock it already holds. Bounding the wait turns an unbounded stall into a
 * `55P03` that rolls the whole lineage back and is retried by the lease.
 *
 * 30 s is comfortably above the incidental waits a healthy workspace produces and
 * well below the default lease, so a timeout is a diagnosis rather than a lost
 * claim.
 */
export const DEFAULT_MIGRATE_LOCK_TIMEOUT_MS = 30_000

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

export interface LedgerGap {
  /** Bundled tags at or below the ledger's high-water mark that it does not record. */
  missing: string[]
  /**
   * Journal `when` of the earliest missing entry — the truncation point.
   *
   * Deleting every row at or above this value is the *minimal* truncation that
   * puts the whole gap back inside drizzle's replay window, so it withdraws the
   * fewest claims that can work.
   */
  from: number
  /**
   * Bundled tags whose ledger rows the truncation deletes, and which drizzle
   * therefore replays and rewrites.
   *
   * These are the migrations we **know** ran, because their row was there. That
   * knowledge is what makes them stricter than the rest of the replay set: see
   * {@link gapHealVerdict}.
   */
  rewrites: string[]
  /**
   * Rows the truncation would delete that this build does not bundle, so nothing
   * can rewrite them. Non-empty means healing would permanently forget a
   * migration that ran — the one case where a truncation stops being recoverable.
   */
  unrewritable: number[]
}

/**
 * The hole in a ledger, if it has one.
 *
 * A ledger is a set, not a counter. `applied.max` says how far the workspace got;
 * it says nothing about what it skipped on the way, and drizzle only ever looks
 * at the maximum. So this asks the question the maximum cannot: *is every
 * bundled migration at or below this ledger's own high-water mark recorded in
 * it?*
 *
 * **An empty ledger is never a gap.** A database that has never been migrated
 * has nothing missing from a prefix it does not have, and treating it as gapped
 * would put provisioning through the heal path — which is the condition most
 * likely to be dropped by someone tightening this later, exactly as it is in
 * {@link replayGateVerdict}.
 */
export function ledgerGapFor(applied: AppliedLedger): LedgerGap | null {
  if (applied.count === 0) return null
  const missing = BUNDLED_MIGRATIONS.filter(
    (e) => e.when <= applied.max && !applied.versions.has(e.when)
  )
  if (missing.length === 0) return null

  const from = missing[0]!.when
  const bundled = new Set(BUNDLED_MIGRATIONS.map((e) => e.when))
  const discards = [...applied.versions].filter((v) => v >= from).sort((a, b) => a - b)
  return {
    missing: missing.map((e) => e.tag),
    from,
    rewrites: discards.filter((v) => bundled.has(v)).map((v) => tagForVersion(v)),
    unrewritable: discards.filter((v) => !bundled.has(v)),
  }
}

export interface MigrationPlan {
  /** Null when the ledger records an unbroken prefix of the bundled journal. */
  gap: LedgerGap | null
  /**
   * The tags drizzle would execute if this plan were run — including, when there
   * is a gap, the effect of the truncation the run would perform first.
   */
  tags: string[]
}

/**
 * What a run would execute against this ledger. The one answer `plan` prints and
 * `migrateWorkspace` acts on, so the two cannot disagree.
 *
 * With no gap this is {@link replaySetFor} unchanged. With a gap it is **every
 * bundled entry from `gap.from` onward**, and that equality is exact rather than
 * approximate: after deleting every row at or above `from`, the new high-water
 * mark is the largest applied value strictly below `from`; every bundled entry
 * below `from` is in the ledger, or one of them would have been the earliest
 * missing entry instead; so the bundled entries above the new mark are precisely
 * the bundled entries at or above `from`.
 *
 * The difference is not cosmetic. On the ledger this fleet actually produced —
 * high-water at `0253` with rows absent for `0249`, `0250`, `0251` and
 * `0252` — `replaySetFor` reports two tags while four are missing, so a plan
 * built on it tells an operator the workspace is nearly current at the moment it is
 * least current.
 */
export function planFor(applied: AppliedLedger): MigrationPlan {
  const gap = ledgerGapFor(applied)
  if (!gap) return { gap: null, tags: replaySetFor(applied) }
  return { gap, tags: BUNDLED_MIGRATIONS.filter((e) => e.when >= gap.from).map((e) => e.tag) }
}

/**
 * May this gap be healed by truncating the ledger and letting drizzle replay?
 *
 * The heal itself is not the interesting part — it is one DELETE, and a DELETE
 * can only ever withdraw claims. What is interesting is that the replay it
 * enables covers two populations with **different evidence**, and lumping them
 * together gets one of them wrong:
 *
 * - **`rewrites` — migrations whose ledger row we are deleting.** Their row was
 *   there, so they *did* run. Replaying them must therefore change nothing:
 *   `safe`, and nothing weaker. A `mutates` one writes a second time, which
 *   atomicity cannot undo. An `errors` one is not merely risky here, it is a
 *   *certainty* — measured: truncating past `0247_user_tags` and replaying fails
 *   on `relation "user_tags" already exists`, and because the rows cannot be put
 *   back (nothing here inserts a ledger row) the workspace is left under-claiming
 *   further than it started, with no run that can ever succeed. Refusing before
 *   the DELETE is the only protection, which is why this runs first.
 * - **`missing` — the hole itself.** Nobody knows whether these ran; that is what
 *   makes it a hole. `errors` is acceptable for the same reason it is acceptable
 *   in an ordinary rollout: `migrate()` wraps the lineage in one transaction, so
 *   the run rolls back whole and Postgres's own message is the diagnosis.
 *   `mutates` is refused, because a statement that succeeds and writes a second
 *   time is the class atomicity cannot save you from.
 *
 * **`allowMutatingReplay` does not reach this gate, deliberately.** That flag
 * means "the operator has established that this ledger is honest". A gap is
 * proof that it is not. The refusal names the migration because the repair is a
 * human deciding, for that specific file, whether its writes already happened.
 */
export function gapHealVerdict(
  gap: LedgerGap,
  verdicts: ReplaySafetyReport[]
): { ok: true } | { ok: false; detail: string } {
  const context =
    `Ledger gap: ${gap.missing.length} bundled migration(s) at or below this database's own ` +
    `high-water mark are absent from its ledger (${gap.missing.join(', ')}). Healing means ` +
    `deleting the ${gap.rewrites.length + gap.unrewritable.length} row(s) from ` +
    `${tagForVersion(gap.from)} onward so drizzle replays the whole span and rewrites them.`

  if (gap.unrewritable.length > 0) {
    return {
      ok: false,
      detail:
        `${context} Refusing: ${gap.unrewritable.length} of those row(s) record migrations this ` +
        `build does not bundle (${gap.unrewritable.join(', ')}), so nothing here can rewrite ` +
        'them and the heal would delete evidence permanently. This workspace is ahead of this ' +
        'image; run the heal from the image that carries those migrations.',
    }
  }

  const byTag = new Map(verdicts.map((v) => [v.tag, v]))
  const unsafeRewrites = gap.rewrites
    .map((tag) => byTag.get(tag))
    .filter((v): v is ReplaySafetyReport => v !== undefined && v.verdict !== 'safe')
  if (unsafeRewrites.length > 0) {
    return {
      ok: false,
      detail:
        `${context} Refusing: ${unsafeRewrites.length} of those migration(s) are recorded as ` +
        'having run and would not be a no-op on a second run — ' +
        unsafeRewrites
          .map(
            (v) =>
              `${v.tag} (${v.verdict}: ${(v.mutating[0] ?? v.erroring[0])?.reason ?? 'not replay-safe'})`
          )
          .join('; ') +
        '. A `mutates` one would write twice; an `errors` one would roll the whole run back ' +
        'every time, and the deleted rows cannot be restored because nothing here inserts a ' +
        'ledger row. A human has to establish, per migration, what this database actually ' +
        'carries. --allow-mutating-replay does not override this: it asserts the ledger is ' +
        'honest, and the gap is proof that it is not.',
    }
  }

  const mutatingHoles = gap.missing
    .map((tag) => byTag.get(tag))
    .filter((v): v is ReplaySafetyReport => v !== undefined && v.verdict === 'mutates')
  if (mutatingHoles.length > 0) {
    return {
      ok: false,
      detail:
        `${context} Refusing: the gap contains ${mutatingHoles.length} migration(s) that would ` +
        'succeed and change data if this database has already had them applied outside the ' +
        'ledger — ' +
        mutatingHoles
          .map((v) => `${v.tag} (${v.mutating[0]?.reason ?? 'writes on replay'})`)
          .join('; ') +
        '. Nothing in the ledger can tell you whether they ran, which is what a gap means. ' +
        'Establish it against the database itself — a branch dry-run is the cheap way ' +
        '(SAAS-HOSTING-STACK.md §10.8) — then repair by hand. Do not insert ledger rows: a ' +
        'wrong row is worse than a missing one. --allow-mutating-replay does not override ' +
        'this gate.',
    }
  }

  return { ok: true }
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
      'Establish whether those migrations already ran — a catalog clone dry-run is the cheap way ' +
      '(SAAS-HOSTING-STACK.md §10.8) — then re-run with allowMutatingReplay once the ledger is ' +
      'known honest. Do not insert ledger rows by hand: a wrong row is worse than a missing one.',
  }
}

function readMigrationSql(tag: string): string {
  return readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8')
}

/**
 * Migrate one workspace, on its direct endpoint, and verify the result.
 *
 * The connection is built here rather than taken from the pool cache, for two
 * reasons that are both correctness rather than tidiness: the pool cache
 * terminates at the **pooled** endpoint, and `pg_advisory_lock` and
 * `CREATE INDEX CONCURRENTLY` both need session mode; and the pool cache asserts
 * the §3 fingerprint on checkout, which a freshly provisioned database has not
 * been stamped for yet. A migrator that could only run against already-stamped
 * databases could not do the one job provisioning needs it for.
 */
export async function migrateWorkspace(
  workspace: WorkspaceDescriptor,
  options: MigrateWorkspaceOptions = {}
): Promise<MigrateWorkspaceResult> {
  const started = Date.now()
  let lastStep: MigrationStep | 'preflight' = 'preflight'
  const dsn = withPassword(workspace.database.directUrl, await resolveWorkspacePassword(workspace))

  const probe = postgres(dsn, { max: 1, onnotice: () => {}, connect_timeout: 20 })
  let before: AppliedLedger
  try {
    before = await readAppliedLedger(probe)
  } finally {
    await probe.end({ timeout: 5 }).catch(() => {})
  }

  const plan = planFor(before)
  const replaySet = plan.tags
  const replayVerdicts = replaySet.map((tag) => assessReplaySafety(tag, readMigrationSql(tag)))
  const mutating = replayVerdicts.filter((r) => r.verdict === 'mutates')

  const base = {
    workspaceKey: workspace.workspaceKey,
    before,
    after: null,
    gap: plan.gap,
    replaySet,
    replayVerdicts,
    healedIndexes: [],
    unhealableIndexes: [],
    postconditions: null,
    lastStep,
    durationMs: Date.now() - started,
  } satisfies Omit<MigrateWorkspaceResult, 'ok' | 'code' | 'detail'>

  // A cheap pre-check, and its shape is deliberate. If there is nothing to
  // apply AND the catalogue already checks out, the workspace is done and the
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
  //
  // A gapped ledger can never take this branch: a gap has at least one missing
  // entry, and `planFor` puts every entry from the gap onward into the set. That
  // is what stops a workspace whose high-water mark is at the tip but whose ledger
  // has a hole from being reported `already_current`.
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
      { workspaceKey: workspace.workspaceKey, violations: early.violations.map((v) => v.detail) },
      'ledger is complete but the database is not correct — healing'
    )
  }

  // Both gates run before anything is written, and this one runs first because
  // its refusal is the one that has to happen before the DELETE — after it,
  // there is no way back.
  if (plan.gap) {
    const heal = gapHealVerdict(plan.gap, replayVerdicts)
    if (!heal.ok) {
      log.error(
        {
          workspaceKey: workspace.workspaceKey,
          missing: plan.gap.missing,
          rewrites: plan.gap.rewrites,
        },
        heal.detail
      )
      return { ...base, ok: false, code: 'refused_ledger_gap', detail: heal.detail }
    }
  }

  const gate = replayGateVerdict(before, replayVerdicts, options.allowMutatingReplay ?? false)
  if (!gate.ok) {
    log.error(
      { workspaceKey: workspace.workspaceKey, mutating: mutating.map((m) => m.tag) },
      gate.detail
    )
    return { ...base, ok: false, code: 'refused_replay_mutates', detail: gate.detail }
  }

  try {
    if (plan.gap) {
      const discarded = await withProbe(dsn, (sql) => truncateAppliedLedger(sql, plan.gap!.from))
      log.warn(
        {
          workspaceKey: workspace.workspaceKey,
          from: tagForVersion(plan.gap.from),
          missing: plan.gap.missing,
          discarded: discarded.length,
        },
        'ledger gap: truncated the ledger so drizzle replays the span it does not record'
      )
    }

    const result = await runMigrations(dsn, {
      concurrentIndexes: !options.skipConcurrentIndexes,
      lockTimeoutMs: options.lockTimeoutMs ?? DEFAULT_MIGRATE_LOCK_TIMEOUT_MS,
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

    // The run has to have done what it said it would, and the ledger is the
    // right instrument for that because the ledger is what the plan was computed
    // from. This is the direct guard against the defect being fixed: a run
    // reporting `reconciled` over a database it did not repair.
    //
    // Asked as "is every planned migration now recorded" rather than "is the
    // ledger still gapped", because the truncation turns a hole into a *short*
    // ledger — and a short ledger has no hole in it. Checking for a gap here
    // would be an assertion that cannot fail, which is worse than no assertion.
    const planned = new Set(replaySet)
    const unrecorded = BUNDLED_MIGRATIONS.filter(
      (e) => planned.has(e.tag) && !after.versions.has(e.when)
    ).map((e) => e.tag)
    if (unrecorded.length > 0) {
      const detail =
        `the run reported success but the ledger does not record ${unrecorded.length} of the ` +
        `${replaySet.length} migration(s) it was to apply (${unrecorded.join(', ')}). Drizzle ` +
        'writes a row only after executing, so this database has not been brought to the ' +
        'planned version and must not be reported as reconciled.'
      log.error({ workspaceKey: workspace.workspaceKey, unrecorded }, detail)
      return {
        ...base,
        after,
        lastStep,
        healedIndexes: result.healed.map((i) => i.name),
        unhealableIndexes: result.unhealable.map((i) => i.name),
        postconditions,
        ok: false,
        code: 'migration_failed',
        detail,
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
      code: plan.gap ? 'healed_ledger_gap' : 'reconciled',
      detail:
        (plan.gap
          ? `healed a ledger gap of ${plan.gap.missing.length} migration(s) ` +
            `(${plan.gap.missing.join(', ')}) by replaying from ${tagForVersion(plan.gap.from)}; `
          : '') +
        `applied ${replaySet.length} migration(s); ledger ${before.count} -> ${after.count}; ` +
        `${result.healed.length} invalid index(es) healed; post-conditions verified`,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    const code = err instanceof PooledDsnRefused ? 'refused_pooled_dsn' : 'migration_failed'
    const detail = err instanceof Error ? err.message : String(err)
    log.error(
      { workspaceKey: workspace.workspaceKey, step: lastStep, err },
      'workspace migration failed'
    )
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
  /** Workspaces claimed per pass. Bounded and global — §10.3. */
  concurrency?: number
  /** Lease duration. Must exceed the slowest workspace migration; see FLEET-MIGRATIONS.md. */
  leaseMs?: number
  /** Push the lease forward this often while a workspace is migrating. */
  heartbeatMs?: number
  cohort?: string
  workspaceKey?: string
  workerId: string
  allowMutatingReplay?: boolean
  /** Stop after this many claimed workspaces. Unbounded when absent. */
  maxWorkspaces?: number
}

export interface ReconcilePassResult {
  claimed: number
  reconciled: number
  /**
   * Workspaces whose ledger had a hole in it that this pass closed. A subset of
   * `reconciled`, reported separately because it is the one outcome that means
   * a database was *wrong* rather than merely behind.
   */
  healed: number
  alreadyCurrent: number
  failed: number
  /** Workspaces whose registry record the request path would refuse. Never migrated. */
  refusedRecords: number
  reaped: { requeued: number; terminated: number }
  outcomes: MigrateWorkspaceResult[]
}

/**
 * One bounded reconcile pass.
 *
 * Claims through the lease, so two migrator replicas take disjoint workspaces and a
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

  const reaped = await reapExpiredWorkspaceLeases()

  const { workspaces, refused } = await listActiveWorkspaces()
  if (refused.length > 0) {
    log.error({ refused }, 'migrator skipping workspaces with invalid registry records')
  }
  const byId = new Map(workspaces.map((t) => [t.workspaceKey, t]))

  const result: ReconcilePassResult = {
    claimed: 0,
    reconciled: 0,
    healed: 0,
    alreadyCurrent: 0,
    failed: 0,
    refusedRecords: refused.length,
    reaped,
    outcomes: [],
  }

  for (;;) {
    const remaining =
      options.maxWorkspaces === undefined ? concurrency : options.maxWorkspaces - result.claimed
    if (remaining <= 0) break

    const batch = await claimWorkspaces({
      limit: Math.min(concurrency, remaining),
      leaseMs,
      workerId: options.workerId,
      cohort: options.cohort,
      workspaceKey: options.workspaceKey,
    })
    if (batch.length === 0) break
    result.claimed += batch.length

    const settled = await Promise.all(
      batch.map((claim) =>
        reconcileClaimed(claim, byId.get(claim.workspaceKey), {
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
      else {
        result.reconciled += 1
        if (outcome.code === 'healed_ledger_gap') result.healed += 1
      }
    }
  }

  return result
}

async function reconcileClaimed(
  claim: ClaimedWorkspace,
  workspace: WorkspaceDescriptor | undefined,
  opts: { heartbeatMs: number; leaseMs: number; allowMutatingReplay?: boolean }
): Promise<MigrateWorkspaceResult> {
  const empty: AppliedLedger = { versions: new Set(), count: 0, max: 0 }
  if (!workspace) {
    const detail =
      `no servable registry record for ${claim.workspaceKey}. The migrator reads workspaces through ` +
      'the same reader the request path uses, so a record the request path would refuse is ' +
      'not migrated either — a half-written record must not become a migrated one.'
    await failWorkspace(claim, detail)
    return {
      workspaceKey: claim.workspaceKey,
      ok: false,
      code: 'migration_failed',
      detail,
      before: empty,
      after: null,
      gap: null,
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
  // as long as the workspace's migration and can never outlive the lease it is
  // extending.
  const beat = setInterval(() => {
    void heartbeatWorkspace(claim, opts.leaseMs).then((held) => {
      if (!held) {
        log.error(
          { workspaceKey: claim.workspaceKey },
          'migrator lease lost while still migrating — another migrator may now own this workspace'
        )
      }
    })
  }, opts.heartbeatMs)
  beat.unref?.()

  try {
    const outcome = await migrateWorkspace(workspace, {
      allowMutatingReplay: opts.allowMutatingReplay,
    })
    if (outcome.ok && outcome.after && outcome.after.max < claim.targetVersion) {
      // This image cannot reach the target. Everything it ships has been
      // applied and the database is correct — it is simply an older build than
      // the control plane is asking for. Recording success here would mark the
      // workspace unclaimable at a version no image produced, and the rollout
      // would report complete having skipped it.
      await failWorkspace(
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
      await completeWorkspace(claim, {
        version: outcome.after.max,
        appliedCount: outcome.after.count,
        postconditionsOk: outcome.postconditions?.ok ?? false,
      })
    } else {
      await failWorkspace(claim, `[${outcome.code}] ${outcome.detail}`, {
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
 * Seed intent rows for every active workspace that has none, at the version this
 * build ships.
 *
 * Provisioning and release are the two triggers §10.3 names for one code path.
 * This is the release trigger's half: a workspace that appears in the registry but
 * not in the intent table is invisible to the reconciler, which is the failure
 * mode where a rollout reports "fleet complete" having skipped a workspace nobody
 * enrolled.
 */
export async function enrolActiveWorkspaces(cohort = 'default'): Promise<number> {
  const target = latestBundledVersion()
  const { workspaces } = await listActiveWorkspaces()
  let created = 0
  for (const t of workspaces) {
    if (
      await ensureSchemaStateRow({ workspaceKey: t.workspaceKey, targetVersion: target, cohort })
    ) {
      created += 1
    }
  }
  return created
}

/**
 * What a run WOULD do, computed by the same functions the run uses.
 *
 * Shares `planFor` and `assessReplaySafety` with {@link migrateWorkspace} rather
 * than recomputing them, because a preflight that can disagree with the thing it
 * is previewing is worse than no preflight. `planFor` in particular is why this
 * no longer under-reports a gapped ledger: it used to print `replaySetFor`,
 * which answers a question about drizzle's high-water mark rather than about the
 * run, and on a hole reports a short tail with no hint that anything is wrong.
 */
export async function planWorkspace(workspace: WorkspaceDescriptor): Promise<{
  applied: AppliedLedger
  gap: LedgerGap | null
  replaySet: string[]
  verdicts: ReplaySafetyReport[]
  /** The refusal an operator would get if they ran this now. Null when it would proceed. */
  refusal: string | null
}> {
  const dsn = withPassword(workspace.database.directUrl, await resolveWorkspacePassword(workspace))
  const applied = await withProbe(dsn, (sql) => readAppliedLedger(sql))
  const { gap, tags } = planFor(applied)
  const verdicts = tags.map((tag) => assessReplaySafety(tag, readMigrationSql(tag)))
  const heal = gap ? gapHealVerdict(gap, verdicts) : { ok: true as const }
  const replay = heal.ok ? replayGateVerdict(applied, verdicts, false) : heal
  return {
    applied,
    gap,
    replaySet: tags,
    verdicts,
    refusal: replay.ok ? null : replay.detail,
  }
}

/** Resolve one workspace for the CLI's single-workspace modes. */
export async function requireWorkspace(workspaceKey: string): Promise<WorkspaceDescriptor> {
  const lookup = await resolveWorkspaceById(workspaceKey)
  if (lookup.kind !== 'ok') {
    throw new Error(
      `workspace ${workspaceKey} is not servable: ${lookup.kind}` +
        ('problems' in lookup ? ` — ${lookup.problems.join('; ')}` : '')
    )
  }
  return lookup.workspace
}
