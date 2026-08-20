/**
 * Healing a ledger with a hole in it, against a real Postgres.
 *
 * `migrator-gate.test.ts` decides *whether* a hole may be closed; nothing pure
 * can establish that closing it works, because the claim is about what Drizzle's
 * migrator does with a `drizzle.__drizzle_migrations` table it did not expect —
 * and that is a property of the driver and of these 234 SQL files, not of our
 * arithmetic about them.
 *
 * The state under test is one that happened. Two live workspaces had a high-water
 * mark at `0253` with rows absent for `0249`, `0250`, `0252`, `0256` and `0257`,
 * `settings.cloud` physically missing, and every page returning 500 — while the
 * reconciler reported `OK [reconciled] post=true` and the post-condition check
 * reported `ok=true`. Both instruments agreed the workspace was fine. The fixtures
 * below reproduce that ledger exactly and assert that neither instrument says so
 * any more.
 *
 * The fixtures withhold every migration this branch adds after `0257` as well.
 * The measured shape is a high-water mark at `0253` with a forward tail above
 * it; a newer migration whose row a fixture kept would push the mark past that
 * tail, folding the tail into the hole and quietly substituting a different
 * shape that still parses.
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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from '@quackback/db/migrate'
import { verifySchemaPostconditions } from '@quackback/db/schema-ops'
import {
  BUNDLED_MIGRATIONS,
  MIGRATIONS_DIR,
  latestBundledVersion,
  readAppliedLedger,
  truncateAppliedLedger,
} from '@quackback/db/schema-version'
import { assessReplaySafety } from '@/lib/server/policy/migration-contract/replay-safety'

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

/**
 * The tail of the corpus whose every migration replays as a no-op.
 *
 * A heal deletes every ledger row from the earliest missing one to the tip and
 * lets drizzle replay the whole span, so a span is healable only when each
 * migration in it is `safe`. That makes the healable window a property of the
 * corpus as it stands today, not a set of tags anyone can write down: the
 * measured `0249` drift these fixtures were built on stopped being healable the
 * moment ordinary migrations with a DELETE and an UPDATE landed above it, and
 * its refusal is asserted below as the refusal it now is.
 *
 * Derived rather than listed for that reason. A migration added above this
 * window keeps it healable if it is guarded; if it is not, the window collapses
 * and `the healable window still exists` says so in one line, instead of six
 * heal assertions failing in ways that read like the heal broke.
 */
const SAFE_SUFFIX = (() => {
  const verdictOf = (tag: string) =>
    assessReplaySafety(tag, readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8')).verdict
  let i = BUNDLED_MIGRATIONS.length
  while (i > 0 && verdictOf(BUNDLED_MIGRATIONS[i - 1]!.tag) === 'safe') i--
  return BUNDLED_MIGRATIONS.slice(i)
})()

/** The row withheld from below the mark: the hole itself. */
const HEAL_HOLE = SAFE_SUFFIX[0]
/** The newest row kept, which is therefore the database's high-water mark. */
const HEAL_MARK = SAFE_SUFFIX[1]
/** Rows withheld from above the mark: an ordinary forward rollout tail. */
const HEAL_TAIL = SAFE_SUFFIX.slice(2)

/**
 * The measured shape, rebuilt inside the healable window: a hole below the
 * mark, a rollout tail above it, and every migration in the span a no-op.
 */
async function applyHealableDrift(db: string): Promise<void> {
  const withheld = [HEAL_HOLE!.when, ...HEAL_TAIL.map((e) => e.when)]
  await withSql(db, (sql) =>
    sql.unsafe(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ANY($1::bigint[])`, [
      withheld,
    ])
  )
}

/**
 * Truncate the ledger at `when`: every row from there up is withheld, and none
 * below it is. That is a contiguous ledger behind the tip — an ordinary rollout
 * — as opposed to a hole, and the two must not be routed the same way.
 */
async function truncateLedgerFrom(db: string, when: number): Promise<void> {
  await withSql(db, (sql) =>
    sql.unsafe(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at >= $1::bigint`, [when])
  )
}

/** The drift measured on two live workspaces, which is no longer healable for free. */
const MEASURED_HOLE = ['0249', '0250', '0252']

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

/**
 * The operator's confirmation, granted where the subject is the HEAL.
 *
 * The bundled tip is now a data migration (0260 demotes every sending domain
 * verified by a check that could not tell an owner from anybody else), and the
 * replay gate refuses any set containing a write against a database with an
 * existing ledger until a human says the ledger is honest. That refusal is a
 * feature and it is asserted in `migrator-gate.test.ts`; restating it in every
 * case here would test the gate over and over and the heal not at all.
 *
 * It does not weaken these cases. `gapHealVerdict` runs first and ignores this
 * flag entirely — a gap is proof the ledger is not honest — so the heal
 * decisions below are made exactly as they would be without it.
 */
const MUTATING_TAIL = { allowMutatingReplay: true } as const

describe('a hole the whole of which is replay-safe', () => {
  it('is healed, and the rows that come back are written by drizzle', async () => {
    const db = await scratch()
    await applyHealableDrift(db)

    const before = await ledgerOf(db)
    // The instrument that could not see this, kept as the control: it reports
    // only the tail above the mark, on a ledger that is also missing the hole
    // beneath it.
    expect(replaySetFor(before)).toEqual(HEAL_TAIL.map((e) => e.tag))
    expect(planFor(before).tags).toEqual(SAFE_SUFFIX.map((e) => e.tag))
    expect(planFor(before).tags.length).toBeGreaterThan(replaySetFor(before).length)
    const digestBefore = await catalogueDigest(db)

    const result = await migrateWorkspace(workspaceOn(db), MUTATING_TAIL)

    expect(result.ok).toBe(true)
    expect(result.code).toBe('healed_ledger_gap')
    expect(result.gap!.missing).toEqual([HEAL_HOLE!.tag])
    // The whole span executed, not just the tail — and the ledger ends complete.
    expect(result.replaySet).toEqual(SAFE_SUFFIX.map((e) => e.tag))
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
    await applyHealableDrift(db)
    const result = await migrateWorkspace(workspaceOn(db), MUTATING_TAIL)
    expect(result.code).not.toBe('reconciled')
    expect(result.code).not.toBe('already_current')
    expect(result.detail).toContain('healed a ledger gap')
    expect(result.detail).toContain(HEAL_HOLE!.tag)
  }, 120_000)
})

describe('the healable window itself', () => {
  it('still exists — a heal needs a hole, a mark above it and a tail above that', () => {
    // The one line that explains the other six if they ever go red together.
    // Every fixture in this file is built inside `SAFE_SUFFIX`, so a migration
    // landing above it that does not replay as a no-op collapses the window and
    // takes the heal cases with it. The fix is to guard that migration the way
    // 0265-0267 are guarded, not to widen anything here.
    expect(
      SAFE_SUFFIX.length,
      `no healable window: the newest ${SAFE_SUFFIX.length} migration(s) replay as no-ops, ` +
        'and a hole below a mark below a tail needs three'
    ).toBeGreaterThanOrEqual(3)

    // And that the three are in the order the fixtures assume. Derived bounds
    // are worth exactly as much as this check: if the hole ever sorted above
    // the mark, `applyHealableDrift` would build a truncation and the heal
    // cases would pass while testing the wrong thing.
    expect(HEAL_HOLE!.when).toBeLessThan(HEAL_MARK!.when)
    for (const e of HEAL_TAIL) expect(e.when).toBeGreaterThan(HEAL_MARK!.when)
  })
})

describe('the drift that was measured, which is no longer healable', () => {
  it('refuses it now, and names the migrations that stopped it being free', async () => {
    // The shape two live workspaces were actually in: a hole at 0249/0250/0252
    // under a mark at 0253. It healed when this file was written. It does not
    // now, and the reason is ordinary: migrations carrying a DELETE and an
    // UPDATE landed above it, and the span from the hole to the tip runs
    // through them. That is the gate working, so it is asserted rather than
    // engineered around — and asserted by name, because "refuses" alone would
    // also pass if it refused for some unrelated reason.
    const db = await scratch()
    const holes = MEASURED_HOLE.map(whenOf)
    await withSql(db, (sql) =>
      sql.unsafe(
        `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ANY($1::bigint[])`,
        [holes]
      )
    )
    const before = await ledgerOf(db)

    const result = await migrateWorkspace(workspaceOn(db), MUTATING_TAIL)

    expect(result.ok).toBe(false)
    expect(result.code).toBe('refused_ledger_gap')
    expect(result.detail).toContain('0264_drop_assistant_custom_actions')
    expect(result.detail).toContain('0268_core_product_flag_defaults')
    // The refusal happens before the DELETE, same as every other refusal here.
    const after = await ledgerOf(db)
    expect(after.count).toBe(before.count)
    expect(after.max).toBe(before.max)
  }, 120_000)
})

describe('the run has to do what it planned, not merely report that it did', () => {
  it('refuses to report reconciled when the ledger does not record the plan', async () => {
    // The executor is stubbed to succeed without running anything, which is the
    // shape of the original defect: `OK [reconciled] post=true` over a database
    // nothing repaired, with the post-condition verdict green beside it. The
    // truncation still really happens, so the ledger the check reads is real.
    const db = await scratch()
    await applyHealableDrift(db)
    executor.pretendItRan = true

    const result = await migrateWorkspace(workspaceOn(db), MUTATING_TAIL)

    expect(result.ok).toBe(false)
    expect(result.code).toBe('migration_failed')
    expect(result.detail).toContain(
      `the ledger does not record ${SAFE_SUFFIX.length} of the ${SAFE_SUFFIX.length}`
    )
    expect(result.detail).toContain(HEAL_HOLE!.tag)
    // Green post-conditions do not rescue it. That combination — a passing
    // catalogue verdict over an unapplied plan — is the exact false green.
    expect(result.postconditions!.ok).toBe(true)
  }, 120_000)

  it('is not a check that cannot fail: the same run un-stubbed reports the heal', async () => {
    const db = await scratch()
    await applyHealableDrift(db)
    const result = await migrateWorkspace(workspaceOn(db), MUTATING_TAIL)
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

describe('a hole whose truncation span reaches a verdict the classifier gets wrong', () => {
  /**
   * A ledger that stops at `top` with the row for `hole` missing.
   *
   * Deleting everything *above* `top` is what makes the fixture sharp. The
   * truncation point is the earliest missing entry, and every applied row at or
   * above it must be replay-safe for the heal to proceed — so a ledger running
   * all the way to the tip would be refused on account of the dozens of ordinary
   * `errors` migrations in between, and the refusal would say nothing about the
   * one migration under test. Pulling the high-water mark down to `top` leaves
   * `rewrites` holding exactly one tag, which is the only way "it refused
   * naming that migration" can mean what it says.
   */
  async function ledgerStoppingAt(db: string, top: string, hole: string): Promise<void> {
    await withSql(db, (sql) =>
      sql.unsafe(
        `DELETE FROM drizzle.__drizzle_migrations
          WHERE created_at > $1::bigint OR created_at = $2::bigint`,
        [whenOf(top), whenOf(hole)]
      )
    )
  }

  /**
   * Both cases run with `allowMutatingReplay`, which is not incidental.
   *
   * That flag is an operator asserting the ledger is honest, and it disables the
   * *other* gate — so with it on, this gate is the only thing standing between a
   * false `safe` verdict and a DELETE. It is also the realistic posture: an
   * operator healing a hole this deep has already been refused once by the
   * replay gate and reached for the flag. Before the verdict was corrected, both
   * of these truncated the ledger and then failed on the replay, leaving the
   * workspace under-claiming further than it started with no run that could ever
   * succeed.
   */
  const healing = { allowMutatingReplay: true } as const

  it('refuses a span that would rewrite 0091, and names it', async () => {
    const db = await scratch()
    await ledgerStoppingAt(db, '0091', '0090')
    const before = await ledgerOf(db)
    const digestBefore = await catalogueDigest(db)

    const result = await migrateWorkspace(workspaceOn(db), healing)

    expect(result.ok).toBe(false)
    expect(result.code).toBe('refused_ledger_gap')
    // Named, and the only candidate: one row would be rewritten and it is this
    // one, so the refusal cannot be crediting an unrelated migration.
    expect(result.gap!.rewrites).toEqual(['0091_drop_conversation_tags'])
    expect(result.detail).toContain('0091_drop_conversation_tags')
    expect(result.detail).toContain('1 of those migration(s) are recorded as having run')
    // And it refused for the reason the override records, not merely because
    // something about the span was unpalatable.
    expect(result.detail).toContain('0127_conversation_tags_rename puts it back')

    // The property that matters more than the refusal: nothing was withdrawn.
    // A truncation here is unrecoverable — drizzle would fail on the replay
    // every time and nothing in this codebase inserts a ledger row.
    const after = await ledgerOf(db)
    expect(after.count).toBe(before.count)
    expect(after.max).toBe(before.max)
    expect(await catalogueDigest(db)).toBe(digestBefore)
  }, 120_000)

  it('refuses a span that would rewrite 0207, and names it', async () => {
    const db = await scratch()
    await ledgerStoppingAt(db, '0207', '0206')
    const before = await ledgerOf(db)

    const result = await migrateWorkspace(workspaceOn(db), healing)

    expect(result.ok).toBe(false)
    expect(result.code).toBe('refused_ledger_gap')
    expect(result.gap!.rewrites).toEqual(['0207_index_tuning'])
    expect(result.detail).toContain('0207_index_tuning')
    expect(result.detail).toContain('1 of those migration(s) are recorded as having run')
    expect(result.detail).toContain('0217_drop_feedback_pipeline drops it')

    const after = await ledgerOf(db)
    expect(after.count).toBe(before.count)
    expect(after.max).toBe(before.max)
  }, 120_000)

  it('still heals a span that reaches neither — the refusal is not over-broad', async () => {
    // The failure mode on the other side. A gate that refused every heal would
    // read as safe and turn the repair tool into a permanent block, which is its
    // own outage: these ledgers are the state five live workspace databases are
    // actually in.
    const db = await scratch()
    await applyHealableDrift(db)

    const result = await migrateWorkspace(workspaceOn(db), healing)

    expect(result.ok).toBe(true)
    expect(result.code).toBe('healed_ledger_gap')
    // Asserted rather than assumed: this span genuinely contains neither of the
    // corrected verdicts, so its passing is a control and not a coincidence.
    expect(result.replaySet).not.toContain('0091_drop_conversation_tags')
    expect(result.replaySet).not.toContain('0207_index_tuning')
    expect(result.after!.count).toBe(BUNDLED_MIGRATIONS.length)
  }, 120_000)
})

describe('the ledgers that are not holes — the controls', () => {
  it('a contiguous ledger behind the tip migrates exactly as it did before', async () => {
    const db = await scratch()
    // Cut inside the replay-safe window, so what comes back is a plain forward
    // rollout rather than a span this build would refuse to replay.
    await truncateLedgerFrom(db, HEAL_HOLE!.when)

    const result = await migrateWorkspace(workspaceOn(db), MUTATING_TAIL)

    expect(result.ok).toBe(true)
    // `reconciled`, not `healed_ledger_gap`: no truncation, no gap, the ordinary
    // rollout path untouched.
    expect(result.code).toBe('reconciled')
    expect(result.gap).toBeNull()
    expect(result.replaySet).toEqual(SAFE_SUFFIX.map((e) => e.tag))
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
    // The live symptom, reproduced: `settings.cloud` absent, ledger complete.
    // Before this check, `verifySchemaPostconditions` returned ok=true for it.
    const db = await scratch()
    const clean = await withSql(db, (sql) => verifySchemaPostconditions(sql))
    expect(clean.ok).toBe(true)
    expect(clean.observed.missingColumns).toEqual([])

    await withSql(db, (sql) => sql.unsafe(`ALTER TABLE settings DROP COLUMN cloud`))
    const report = await withSql(db, (sql) => verifySchemaPostconditions(sql))

    expect(report.ok).toBe(false)
    expect(report.observed.missingColumns).toEqual(['public.settings.cloud'])
    expect(report.violations.find((v) => v.kind === 'missing_column')!.detail).toContain(
      'public.settings.cloud'
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
    await withSql(db, (sql) => sql.unsafe(`ALTER TABLE settings DROP COLUMN cloud`))

    const result = await migrateWorkspace(workspaceOn(db))

    // Nothing to apply and nothing to heal, so the ledger has no complaint. The
    // catalogue does, and it is now the one that decides.
    expect(result.ok).toBe(false)
    expect(result.code).toBe('postconditions_violated')
    expect(result.detail).toContain('settings.cloud')
  }, 120_000)
})

describe('the lock a replay of 0253 has to take', () => {
  /**
   * `0253_job_queue` builds indexes on `job_queue` and replaces its wake
   * trigger, and both want a lock that conflicts with the ROW EXCLUSIVE the job
   * poller holds while it claims work. On a fresh rollout the table does not
   * exist yet so nothing contends; on a *replay* — which is what healing a hole
   * spanning 0253 does — the workspace's worker tier is live. Measured against the
   * fleet, that pair does not queue politely.
   */
  async function replayFrom0253(db: string, lockTimeoutMs?: number) {
    await withSql(db, (sql) => truncateAppliedLedger(sql, whenOf('0253')))
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
      const pending = replayFrom0253(db).then(
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
      const err = await replayFrom0253(db, 500).then(
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
      expect(after.max).toBeLessThan(whenOf('0253'))
      expect(after.versions.has(whenOf('0253'))).toBe(false)
    } finally {
      await holder.unsafe(`ROLLBACK`).catch(() => {})
      await holder.end({ timeout: 5 }).catch(() => {})
    }
  }, 120_000)
})
