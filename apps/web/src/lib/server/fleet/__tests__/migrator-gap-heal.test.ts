/**
 * Healing a ledger with a hole in it, against a real Postgres.
 *
 * `migrator-gate.test.ts` decides *whether* a hole may be closed; nothing pure
 * can establish that closing it works, because the claim is about what Drizzle's
 * migrator does with a `drizzle.__drizzle_migrations` table it did not expect —
 * and that is a property of the driver and of these 234 SQL files, not of our
 * arithmetic about them.
 *
 * The state under test has a high-water mark at `0252`, the `0250` row absent,
 * and the forward tail withheld. It reproduces the ledger shape that once let a
 * reconciler report success while skipping a hole below the high-water mark.
 *
 * ## Method
 *
 * - **Every test gets its own database**, copied from one fully migrated
 *   template. Nothing here touches the shared `quackback_test`, and no assertion
 *   counts rows it does not own.
 * - **`migrateWorkspace` is the subject, not a re-implementation of it.** The only
 *   seam is the workspace's password: `withPassword` is a pure string function, so
 *   a descriptor pointing at the scratch database and a stubbed password
 *   resolver put the real function on a real database with its real gates.
 * - **"Unchanged" is only ever asserted about quiescent things.** The catalogue
 *   digest reads `information_schema.columns` and `pg_index`, and the ledger
 *   check reads `drizzle.__drizzle_migrations` — none of which any tier writes
 *   in the background. Row counts of `job_queue` or the kv tables could not
 *   answer "did anything change" on a live workspace, so they are not used to
 *   answer it here either.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from '@quackback/db/migrate'
import { verifySchemaPostconditions } from '@quackback/db/schema-ops'
import {
  BUNDLED_MIGRATIONS,
  latestBundledVersion,
  readAppliedLedger,
  truncateAppliedLedger,
} from '@quackback/db/schema-version'

// The migrator resolves a workspace's password through the pool cache, which wants
// a control database and a secrets vendor. Everything else on the path — the DSN
// assembly, both gates, the truncation, the executor, the post-run check — is
// the real code.
vi.mock('@/lib/server/workspaces/pool-cache', () => ({
  resolveWorkspacePassword: async () => 'password',
}))

/**
 * A switch that makes the executor claim success without executing anything.
 *
 * Off for every test but one. The migrator's post-run check — *did the run
 * actually close the hole?* — is unreachable while the gates in front of it do
 * their job, and an assertion no test can redden is not an assertion. This is
 * the smallest thing that reaches it, and what it simulates is precisely the
 * defect being fixed: an executor reporting `reconciled` over a database that is
 * still wrong.
 */
const executor = vi.hoisted(() => ({ pretendItRan: false }))

vi.mock('@quackback/db/migrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quackback/db/migrate')>()
  return {
    ...actual,
    runMigrations: async (...args: Parameters<typeof actual.runMigrations>) =>
      executor.pretendItRan
        ? {
            healed: [],
            unhealable: [],
            postconditions: {
              ok: true,
              violations: [],
              covers: [],
              observed: {
                invalidIndexes: [],
                missingIndexes: [],
                extensions: [],
                missingTables: [],
                missingColumns: [],
              },
            },
          }
        : actual.runMigrations(...args),
  }
})

const { ledgerGapFor, migrateWorkspace, planFor, replaySetFor } = await import('../migrator')
type WorkspaceDescriptor = Parameters<typeof migrateWorkspace>[0]

const ADMIN_URL =
  process.env.DRIFT_CHECK_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/postgres'
const SUFFIX = randomUUID().replace(/-/g, '').slice(0, 10)
const TEMPLATE = `qb_gapheal_tpl_${SUFFIX}`

let admin: postgres.Sql
const created: string[] = []

const dsnFor = (db: string) => ADMIN_URL.replace(/\/[^/]+$/, `/${db}`)

/** A descriptor whose direct URL carries no password, so `withPassword` supplies one. */
const workspaceOn = (db: string): WorkspaceDescriptor =>
  ({
    workspaceKey: `inst_gapheal_${db.slice(-6)}`,
    database: {
      directUrl: dsnFor(db).replace(/:\/\/([^:@]+):[^@]*@/, '://$1@'),
      credentialRef: 'literal://unused',
    },
  }) as unknown as WorkspaceDescriptor

/** A copy of the fully migrated template, for one test to ruin however it likes. */
async function scratch(): Promise<string> {
  const name = `qb_gapheal_${SUFFIX}_${created.length}`
  await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE}`)
  created.push(name)
  return name
}

async function withSql<T>(db: string, body: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(dsnFor(db), { max: 1, onnotice: () => {} })
  try {
    return await body(sql)
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

const whenOf = (prefix: string) =>
  BUNDLED_MIGRATIONS.find((e) => e.tag.startsWith(`${prefix}_`))!.when

/** Delete ledger rows without touching the schema — what `psql -f` drift leaves behind. */
async function dropLedgerRows(db: string, ...prefixes: string[]): Promise<void> {
  const whens = prefixes.map(whenOf)
  await withSql(db, (sql) =>
    sql.unsafe(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ANY($1::bigint[])`, [
      whens,
    ])
  )
}

const ledgerOf = (db: string) => withSql(db, (sql) => readAppliedLedger(sql))

/**
 * A digest of the things a migration run is supposed to leave alone.
 *
 * Deliberately catalogue-only. The trap this avoids is real: an instrument that
 * reads hot tables cannot answer "did anything change", because on a live workspace
 * the worker tier writes `job_queue` and the kv tables continuously. Column
 * shapes and index validity are written by DDL and by nothing else.
 */
async function catalogueDigest(db: string): Promise<string> {
  return withSql(db, async (sql) => {
    const rows = await sql.unsafe<{ digest: string }[]>(`
      SELECT md5(string_agg(x, '|' ORDER BY x)) AS digest FROM (
        SELECT table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||
               coalesce(column_default,'')||':'||is_nullable AS x
          FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        UNION ALL
        SELECT 'idx:'||c.relname||':'||i.indisvalid AS x
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ) t
    `)
    return rows[0]!.digest
  })
}

beforeAll(async () => {
  admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} })
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${TEMPLATE}`)
  // The full production path — extensions, lineage, concurrent indexes, seed and
  // verify — so a copy of it is a workspace that is genuinely correct, and the
  // post-condition check has something honest to pass on.
  await runMigrations(dsnFor(TEMPLATE), {})
}, 180_000)

afterAll(async () => {
  for (const db of created) {
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => {})
  }
  await admin?.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`).catch(() => {})
  await admin?.end({ timeout: 5 }).catch(() => {})
}, 180_000)

afterEach(() => {
  executor.pretendItRan = false
  vi.restoreAllMocks()
})

describe('a hole the whole of which is replay-safe', () => {
  it('is healed, and the rows that come back are written by drizzle', async () => {
    const db = await scratch()
    await dropLedgerRows(db, '0250', '0253', '0254', '0255', '0256')

    const before = await ledgerOf(db)
    // The instrument that could not see this, kept as the control: it reports a
    // four-migration tail on a ledger that also has a hole beneath its mark.
    expect(replaySetFor(before)).toHaveLength(4)
    expect(planFor(before).tags).toHaveLength(7)
    const digestBefore = await catalogueDigest(db)

    const result = await migrateWorkspace(workspaceOn(db))

    expect(result.ok).toBe(true)
    expect(result.code).toBe('healed_ledger_gap')
    expect(result.gap!.missing).toEqual(['0250_job_queue'])
    // Seven executed, not two — and the ledger ends complete.
    expect(result.replaySet).toHaveLength(7)
    expect(result.after!.count).toBe(BUNDLED_MIGRATIONS.length)
    expect(ledgerGapFor(result.after!)).toBeNull()
    expect(result.postconditions!.ok).toBe(true)

    // Nothing about the schema moved. The replay was a replay.
    expect(await catalogueDigest(db)).toBe(digestBefore)
  }, 120_000)

  it('reports a gap distinctly from being up to date', async () => {
    // The failure this replaces: the same database, reconciled, reported
    // `[reconciled]` with `applied=2` and was still broken. A code that means
    // "this database was wrong" has to be distinguishable from one that means
    // "this database was behind".
    const db = await scratch()
    await dropLedgerRows(db, '0250', '0253', '0254', '0255', '0256')
    const result = await migrateWorkspace(workspaceOn(db))
    expect(result.code).not.toBe('reconciled')
    expect(result.code).not.toBe('already_current')
    expect(result.detail).toContain('healed a ledger gap')
    expect(result.detail).toContain('0250_job_queue')
  }, 120_000)
})

describe('the run has to do what it planned, not merely report that it did', () => {
  it('refuses to report reconciled when the ledger does not record the plan', async () => {
    // The executor is stubbed to succeed without running anything, which is the
    // shape of the original defect: `OK [reconciled] post=true` over a database
    // nothing repaired, with the post-condition verdict green beside it. The
    // truncation still really happens, so the ledger the check reads is real.
    const db = await scratch()
    await dropLedgerRows(db, '0250', '0253', '0254', '0255', '0256')
    executor.pretendItRan = true

    const result = await migrateWorkspace(workspaceOn(db))

    expect(result.ok).toBe(false)
    expect(result.code).toBe('migration_failed')
    expect(result.detail).toContain('the ledger does not record 7 of the 7')
    expect(result.detail).toContain('0250_job_queue')
    // Green post-conditions do not rescue it. That combination — a passing
    // catalogue verdict over an unapplied plan — is the exact false green.
    expect(result.postconditions!.ok).toBe(true)
  }, 120_000)

  it('is not a check that cannot fail: the same run un-stubbed reports the heal', async () => {
    const db = await scratch()
    await dropLedgerRows(db, '0250', '0253', '0254', '0255', '0256')
    const result = await migrateWorkspace(workspaceOn(db))
    expect(result.code).toBe('healed_ledger_gap')
  }, 120_000)
})

describe('a hole that must not be healed', () => {
  it('refuses when a row it would delete records a migration that is not a no-op', async () => {
    const db = await scratch()
    await dropLedgerRows(db, '0246')
    const before = await ledgerOf(db)

    const result = await migrateWorkspace(workspaceOn(db))

    expect(result.ok).toBe(false)
    expect(result.code).toBe('refused_ledger_gap')
    expect(result.detail).toContain('0247_user_tags')
    // The property that matters more than the refusal itself: the refusal
    // happens BEFORE the DELETE. A truncation that then cannot replay is
    // unrecoverable, because nothing here inserts a ledger row.
    const after = await ledgerOf(db)
    expect(after.count).toBe(before.count)
    expect(after.max).toBe(before.max)
  }, 120_000)

  it('refuses when the hole contains a mutating migration, and names it', async () => {
    const db = await scratch()
    await withSql(db, (sql) =>
      sql.unsafe(
        `DELETE FROM drizzle.__drizzle_migrations
          WHERE created_at >= $1::bigint AND created_at <> $2::bigint`,
        [whenOf('0006'), whenOf('0012')]
      )
    )
    const before = await ledgerOf(db)

    const result = await migrateWorkspace(workspaceOn(db))

    expect(result.ok).toBe(false)
    expect(result.code).toBe('refused_ledger_gap')
    expect(result.detail).toContain('0006_thick_arclight')
    expect(result.detail).toContain('--allow-mutating-replay does not override')
    expect((await ledgerOf(db)).count).toBe(before.count)
  }, 120_000)

  it('refuses the same hole even when the operator passes --allow-mutating-replay', async () => {
    // The flag asserts the ledger is honest. A hole is proof that it is not, so
    // the escape hatch must not reach this gate — and the only way to be sure is
    // to run it with the flag on.
    const db = await scratch()
    await withSql(db, (sql) =>
      sql.unsafe(
        `DELETE FROM drizzle.__drizzle_migrations
          WHERE created_at >= $1::bigint AND created_at <> $2::bigint`,
        [whenOf('0006'), whenOf('0012')]
      )
    )
    const result = await migrateWorkspace(workspaceOn(db), { allowMutatingReplay: true })
    expect(result.code).toBe('refused_ledger_gap')
    expect(result.detail).toContain('0006_thick_arclight')
  }, 120_000)
})

describe('the ledgers that are not holes — the controls', () => {
  it('a contiguous ledger behind the tip migrates exactly as it did before', async () => {
    const db = await scratch()
    await dropLedgerRows(db, '0255', '0256')

    const result = await migrateWorkspace(workspaceOn(db))

    expect(result.ok).toBe(true)
    // `reconciled`, not `healed_ledger_gap`: no truncation, no gap, the ordinary
    // rollout path untouched.
    expect(result.code).toBe('reconciled')
    expect(result.gap).toBeNull()
    expect(result.replaySet).toEqual([
      '0255_settings_cloud_tenant_id',
      '0256_workspace_key_columns',
    ])
    expect(result.after!.count).toBe(BUNDLED_MIGRATIONS.length)
  }, 120_000)

  it('an empty ledger is a provisioning run, not a replay', async () => {
    const db = `qb_gapheal_${SUFFIX}_fresh`
    await admin.unsafe(`CREATE DATABASE ${db}`)
    created.push(db)

    const result = await migrateWorkspace(workspaceOn(db))

    expect(result.ok).toBe(true)
    expect(result.code).toBe('reconciled')
    expect(result.gap).toBeNull()
    expect(result.before.count).toBe(0)
    expect(result.replaySet).toHaveLength(BUNDLED_MIGRATIONS.length)
    expect(result.after!.count).toBe(BUNDLED_MIGRATIONS.length)
    expect(result.postconditions!.ok).toBe(true)
  }, 300_000)

  it('a ledger already at the tip is a no-op that touches nothing', async () => {
    const db = await scratch()
    const digestBefore = await catalogueDigest(db)
    const before = await ledgerOf(db)

    const result = await migrateWorkspace(workspaceOn(db))

    expect(result.code).toBe('already_current')
    expect(result.gap).toBeNull()
    expect(result.replaySet).toEqual([])
    expect(result.after!.count).toBe(before.count)
    expect(await catalogueDigest(db)).toBe(digestBefore)
  }, 120_000)

  it('a workspace ahead of this build is served, not healed', async () => {
    // Its ledger carries a `when` this image has never heard of. That is not a
    // hole, and a heal here would delete a row nothing could write back.
    const db = await scratch()
    await withSql(db, (sql) =>
      sql.unsafe(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('future', $1::bigint)`,
        [latestBundledVersion() + 1_000]
      )
    )
    const result = await migrateWorkspace(workspaceOn(db))
    expect(result.code).toBe('already_current')
    expect(result.gap).toBeNull()
  }, 120_000)
})

describe('what the post-condition check can now see', () => {
  it('reports a declared column the database does not have', async () => {
    // The symptom, reproduced: a declared scope column absent, ledger complete.
    // Before this check, `verifySchemaPostconditions` returned ok=true for it.
    const db = await scratch()
    const clean = await withSql(db, (sql) => verifySchemaPostconditions(sql))
    expect(clean.ok).toBe(true)
    expect(clean.observed.missingColumns).toEqual([])

    await withSql(db, (sql) => sql.unsafe(`ALTER TABLE job_queue DROP COLUMN workspace_key`))
    const report = await withSql(db, (sql) => verifySchemaPostconditions(sql))

    expect(report.ok).toBe(false)
    expect(report.observed.missingColumns).toEqual(['public.job_queue.workspace_key'])
    expect(report.violations.find((v) => v.kind === 'missing_column')!.detail).toContain(
      'public.job_queue.workspace_key'
    )
    // The control that makes the finding attributable: the checks that existed
    // before are unmoved by a dropped column, which is exactly why they reported
    // a broken workspace as correct.
    expect(report.observed.invalidIndexes).toEqual(clean.observed.invalidIndexes)
    expect(report.observed.extensions).toEqual(clean.observed.extensions)
    expect(report.observed.missingIndexes).toEqual(clean.observed.missingIndexes)
  }, 120_000)

  it('refuses the workspace whose ledger is complete and whose schema is not', async () => {
    const db = await scratch()
    await withSql(db, (sql) => sql.unsafe(`ALTER TABLE job_queue DROP COLUMN workspace_key`))

    const result = await migrateWorkspace(workspaceOn(db))

    // Nothing to apply and nothing to heal, so the ledger has no complaint. The
    // catalogue does, and it is now the one that decides.
    expect(result.ok).toBe(false)
    expect(result.code).toBe('postconditions_violated')
    expect(result.detail).toContain('job_queue.workspace_key')
  }, 120_000)
})

describe('the lock a replay of 0250 has to take', () => {
  /**
   * `0250_job_queue` builds indexes on `job_queue` and replaces its wake
   * trigger, and both want a lock that conflicts with the ROW EXCLUSIVE the job
   * poller holds while it claims work. On a fresh rollout the table does not
   * exist yet so nothing contends; on a *replay* — which is what healing a hole
   * spanning 0250 does — the workspace's worker tier is live. Measured against the
   * fleet, that pair does not queue politely.
   */
  async function replayFrom0250(db: string, lockTimeoutMs?: number) {
    await withSql(db, (sql) => truncateAppliedLedger(sql, whenOf('0250')))
    return runMigrations(dsnFor(db), {
      concurrentIndexes: false,
      seed: false,
      verify: false,
      lockTimeoutMs,
    })
  }

  it('waits forever without a lock_timeout, and fails fast with one', async () => {
    const db = await scratch()
    const holder = postgres(dsnFor(db), { max: 1, onnotice: () => {} })
    try {
      await holder.unsafe(`BEGIN`)
      await holder.unsafe(`LOCK TABLE job_queue IN ROW EXCLUSIVE MODE`)

      // The control. The wait is unbounded, so "still pending" after a second is
      // not a race — it can only fail if the locks do not actually conflict.
      let settled = false
      const pending = replayFrom0250(db).then(
        () => (settled = true),
        () => (settled = true)
      )
      await new Promise((r) => setTimeout(r, 1_000))
      expect(settled).toBe(false)

      const waiting = await holder.unsafe<{ mode: string; granted: boolean }[]>(`
        SELECT l.mode, l.granted FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
         WHERE c.relname = 'job_queue' AND NOT l.granted
      `)
      expect(waiting.length).toBeGreaterThan(0)

      await holder.unsafe(`ROLLBACK`)
      await pending
      expect(settled).toBe(true)

      // Same contention, bounded.
      await holder.unsafe(`BEGIN`)
      await holder.unsafe(`LOCK TABLE job_queue IN ROW EXCLUSIVE MODE`)
      const started = Date.now()
      const err = await replayFrom0250(db, 500).then(
        () => null,
        (e: Error) => e
      )
      expect(err).not.toBeNull()
      expect((err!.cause as { code?: string } | undefined)?.code).toBe('55P03')
      expect(Date.now() - started).toBeLessThan(5_000)
      await holder.unsafe(`ROLLBACK`)

      // The lineage is one transaction, so the aborted run changed nothing and
      // the ledger is still merely under-claiming — the recoverable direction.
      const after = await ledgerOf(db)
      expect(after.max).toBeLessThan(whenOf('0250'))
      expect(after.versions.has(whenOf('0250'))).toBe(false)
    } finally {
      await holder.unsafe(`ROLLBACK`).catch(() => {})
      await holder.end({ timeout: 5 }).catch(() => {})
    }
  }, 120_000)
})
