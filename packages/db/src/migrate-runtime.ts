/**
 * The migration executor, callable from anywhere that holds a connection
 * string — the CLI entrypoint, a provisioning path, or the fleet migrator role
 * (SAAS-HOSTING-STACK.md §10.3).
 *
 * ## What this used to be, and what it was missing
 *
 * This function existed already and was already parameterised by connection
 * string, already idempotent, already chaining `migrate()` into
 * `seedSystemData()`. Three gaps were measured against live workspaces on
 * 2026-08-08, and the first was worse than a gap:
 *
 * 1. **It never issued `CREATE EXTENSION vector`, and no migration file does
 *    either, while `0000_initial` declares `vector` columns.** A fresh database
 *    migrated through this path could not succeed at all. Only the `migrate.ts`
 *    CLI created the extension.
 * 2. **It never called the concurrent-index step**, so the 4 HNSW and 3 trigram
 *    indexes silently did not exist. No error — an absent index is not an error,
 *    it is a slow workspace.
 * 3. **An interrupted `CREATE INDEX CONCURRENTLY` leaves an *invalid* index**,
 *    `IF NOT EXISTS` then treats it as present, and the next run exits 0. So the
 *    heal cannot be "re-run and hope": invalid indexes are dropped *before* the
 *    build, and post-conditions are verified *after* against the catalogue.
 *
 * ## Atomicity, and exactly where it stops
 *
 * `migrate()` wraps the whole loop in one transaction (drizzle-orm@0.45.2), so
 * the lineage is atomic — never partial. Everything around it is not: the
 * extension creation, the index builds and the seed each run outside that
 * transaction. A kill in the tail therefore leaves a **complete ledger and a
 * broken database**. That is why {@link RunMigrationsResult} reports the
 * post-condition verdict separately from the ledger, and why a caller must
 * never read "all migrations applied" as "the database is correct".
 *
 * ## Session mode, and what actually breaks
 *
 * Measured through a transaction-mode pooler rather than assumed, and the answer is
 * not the one usually given:
 *
 * - **`CREATE INDEX CONCURRENTLY` works through the pooler.** It is one
 *   statement to the client; the multi-transaction dance happens server-side
 *   where the pooler cannot see it. So "CIC cannot run through a pooler" is
 *   wrong, and a guard justified only by that would be justified by nothing.
 * - **`pg_advisory_lock` is where it breaks, and it breaks badly.** The lock is
 *   session-scoped, and a pooled client's "session" is a server connection the
 *   pooler keeps alive after the client disconnects. Measured: take the lock
 *   through the pooler, disconnect, and the lock is still held; and a client on
 *   the **direct** endpoint asking for that key blocks — verified by watching it
 *   die on a 10 s `lock_timeout` until the stranded backend was terminated by
 *   hand.
 * - **The mutual-exclusion failure is non-deterministic, not total.** A second
 *   pooled client got `pg_try_advisory_lock = true` for the held key — but
 *   because the pooler routed it onto the *same backend*, where it re-entered
 *   its own lock (hold count 2; the third unlock returned false). Forced onto a
 *   fresh backend it correctly returned false. So the mutex fails open depending
 *   on pool routing, which is worse than one that never works: it works in
 *   testing.
 *
 * So a migrator run through the pooler does not merely lose its own
 * serialisation: it strands a lock that wedges every subsequent direct run of
 * the same workspace. That is why the pooled endpoint is refused up front rather
 * than allowed to half-work — see {@link assertSessionModeDsn}.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema'
import { seedSystemData } from './seed-system'
import {
  MIGRATION_LOCK_NS,
  dropInvalidIndexes,
  ensureConcurrentIndexes,
  ensureExtensions,
  verifySchemaPostconditions,
  type InvalidIndex,
  type PostconditionReport,
} from './schema-ops'
import { MIGRATIONS_DIR } from './schema-version'

// The same directory the replay-safety preflight reads, deliberately shared
// rather than re-derived: a run that executes files the plan did not read is
// the failure `MIGRATIONS_DIR` exists to prevent, and two copies of the same
// expression drift the moment one of them learns something the other does not.
const MIGRATIONS_FOLDER = MIGRATIONS_DIR

export type MigrationStep =
  | 'connect'
  | 'lock'
  | 'extensions'
  | 'heal-invalid-indexes'
  | 'migrate'
  | 'concurrent-indexes'
  | 'seed'
  | 'verify'

export interface RunMigrationsOptions {
  /**
   * Take the session-level advisory lock, so concurrent replicas racing to
   * migrate the same database serialise instead of colliding. Default true.
   */
  lock?: boolean
  /** Build the concurrent indexes after migrating. Default true. */
  concurrentIndexes?: boolean
  /** Reconcile the system data (statuses, RBAC catalogue, presets). Default true. */
  seed?: boolean
  /**
   * Verify post-conditions against the catalogue afterwards. Default true.
   *
   * The verdict is returned rather than thrown, because a failed post-condition
   * on a database whose migrations all applied is a *diagnosis*, and the caller
   * (the reconciler) is the thing that decides what to do about it.
   */
  verify?: boolean
  /**
   * Refuse a connection string that looks like a transaction-mode pooler.
   * Default true; see {@link assertSessionModeDsn}.
   */
  requireSessionMode?: boolean
  /**
   * Override the bundled migrations folder. Only the Docker entrypoint needs
   * this; the image lays the SQL out somewhere other than the source tree.
   */
  migrationsFolder?: string
  /**
   * `lock_timeout` for the migration transaction, so a statement that cannot get
   * the table lock it needs **fails fast instead of waiting**. Unset means no
   * timeout, which is the historical behaviour and what the boot path keeps.
   *
   * The hazard is specific and was hit against the live fleet. `0253_job_queue`
   * contains `DROP TRIGGER IF EXISTS job_queue_wake_trg ON job_queue`, which
   * needs ACCESS EXCLUSIVE on `job_queue` — a table the worker tier's poller
   * holds ROW EXCLUSIVE on continuously. The migration transaction has already
   * touched `job_queue` by then, so it is asking to *upgrade* a lock it holds
   * while another session holds a conflicting one, which is the classic shape of
   * a deadlock rather than a wait. Postgres detects it and kills one side after
   * `deadlock_timeout`, and which side loses is not ours to choose.
   *
   * A timeout does not prevent the contention; it bounds it. The lineage is one
   * transaction, so a `55P03` rolls the whole run back and changes nothing, the
   * reconciler records the failure with its diagnosis, and the lease's own
   * backoff retries — which is a better retry than a new one here, because it
   * counts against `max_attempts` and therefore cannot loop forever against a
   * workspace whose worker never goes quiet.
   */
  lockTimeoutMs?: number
  /** Progress callback, so a reconciler can report which step a kill landed in. */
  onStep?: (step: MigrationStep) => void
}

export interface RunMigrationsResult {
  /** Invalid indexes dropped before migrating, so the build could rebuild them. */
  healed: InvalidIndex[]
  /** Invalid indexes a constraint owns, which `DROP INDEX` cannot remove. */
  unhealable: InvalidIndex[]
  /** Null when `verify: false`. Never derived from the migration ledger. */
  postconditions: PostconditionReport | null
}

export class PooledDsnRefused extends Error {
  constructor(host: string) {
    super(
      `refusing to migrate through what looks like a transaction-mode pooler (${host}). ` +
        'The migration advisory lock is session-scoped, and a pooled session outlives the ' +
        'client: measured through a transaction-mode pooler, the lock survives disconnect, does not exclude a second ' +
        'pooled client, and then BLOCKS the direct endpoint until the stranded backend is ' +
        "terminated by hand. Use the workspace record's directUrl."
    )
    this.name = 'PooledDsnRefused'
  }
}

/**
 * Refuse a pooled endpoint before it half-works.
 *
 * A transaction-mode pooler host often carries a `-pooler` suffix, and the same
 * signal is what the control plane's own `cp_workspace_registry_direct_not_pooler_ck`
 * constraint checks — so a record that passed the CP's write gate cannot fail
 * this one, and a hand-edited DSN cannot silently strand a lock.
 *
 * The check is a heuristic on a hostname and is deliberately conservative: it
 * refuses rather than probes, because the probe for "is this session mode"
 * that most people reach for — asking the catalogue — is the false-green
 * instrument this plan has already been burned by twice.
 */
export function assertSessionModeDsn(connectionString: string): void {
  let host: string
  try {
    host = new URL(connectionString).hostname
  } catch {
    return
  }
  if (host.includes('-pooler.') || host.startsWith('-pooler') || host.endsWith('-pooler')) {
    throw new PooledDsnRefused(host)
  }
}

/**
 * Run database migrations programmatically.
 *
 * @param connectionString - Optional connection string. Defaults to DATABASE_URL env var.
 */
export async function runMigrations(
  connectionString?: string,
  options: RunMigrationsOptions = {}
): Promise<RunMigrationsResult> {
  const connStr = connectionString || process.env.DATABASE_URL

  if (!connStr) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const {
    lock = true,
    concurrentIndexes = true,
    seed = true,
    verify = true,
    requireSessionMode = true,
    migrationsFolder = MIGRATIONS_FOLDER,
    lockTimeoutMs,
    onStep = () => {},
  } = options

  if (lockTimeoutMs !== undefined && !Number.isSafeInteger(lockTimeoutMs)) {
    throw new Error(`lockTimeoutMs must be an integer number of milliseconds, got ${lockTimeoutMs}`)
  }

  if (requireSessionMode) assertSessionModeDsn(connStr)

  onStep('connect')
  // One connection: the advisory lock is session-scoped, so every statement in
  // this run has to land on the same backend.
  const sql = postgres(connStr, { max: 1, onnotice: () => {} })
  const database = drizzle(sql, { schema })

  let locked = false
  try {
    if (lock) {
      onStep('lock')
      await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_NS}, hashtext(current_database()))`
      locked = true
    }

    onStep('extensions')
    await ensureExtensions(sql)

    onStep('heal-invalid-indexes')
    const healed = await dropInvalidIndexes(sql)

    onStep('migrate')
    // Scoped to the lineage rather than set for the whole run: the concurrent
    // index step that follows waits on old snapshots rather than on locks, and a
    // timeout there would abort a build that was making progress.
    if (lockTimeoutMs !== undefined) {
      await sql.unsafe(`SET lock_timeout = ${lockTimeoutMs}`)
    }
    try {
      await migrate(database, { migrationsFolder })
    } finally {
      if (lockTimeoutMs !== undefined) await sql.unsafe(`SET lock_timeout = 0`).catch(() => {})
    }

    if (concurrentIndexes) {
      onStep('concurrent-indexes')
      await ensureConcurrentIndexes(sql)
    }

    if (seed) {
      onStep('seed')
      // Seed the reference data every workspace needs (statuses, roles,
      // permissions). Idempotent — re-running on a seeded workspace is a no-op.
      await seedSystemData(database)
    }

    let postconditions: PostconditionReport | null = null
    if (verify) {
      onStep('verify')
      postconditions = await verifySchemaPostconditions(sql)
    }

    return { healed: healed.dropped, unhealable: healed.skipped, postconditions }
  } finally {
    if (locked) {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_NS}, hashtext(current_database()))`.catch(
        () => {}
      )
    }
    await sql.end()
  }
}
