/**
 * The whole migration lineage, applied twice, against a real Postgres.
 *
 * `replay-safety.ts` answers "would a second run of this migration change
 * anything?" by reading the SQL. Every answer it gives is a claim about a
 * database it has never seen, and the fleet migrator spends those claims: its
 * gap-heal truncates the ledger to before the earliest missing entry and replays
 * forward against a database that already carries the effects. A `safe` verdict
 * that is wrong does not fail here — it fails on a live workspace, mid-heal,
 * with the ledger rows already withdrawn.
 *
 * So this is where the claims get checked against Postgres instead of against a
 * regex. It applies the lineage once, then applies **every migration the
 * classifier calls `safe`** a second time to the same database, and asserts the
 * catalogue does not move.
 *
 * That is the whole of the lineage that claims anything. The other 197 files
 * claim only `errors` or `mutates`, which are refusals — a replay is never
 * attempted for them, so there is nothing to check. Re-running them and
 * asserting they fail would be asserting something the classifier deliberately
 * does not promise: `errors` is the conservative bucket, and a file in it is
 * *allowed* to succeed.
 *
 * ## Why this exists rather than a reviewer reading the SQL
 *
 * `0256_workspace_key_columns` is `safe` only because a human wrote
 * `-- @replay: guarded-by …` above a `DO` block the classifier cannot read
 * inside. An annotation is a claim someone can get wrong, and a claim nothing
 * checks is a loophole. This is the check — and it is not narrow to that one
 * file, which is the point: it validates every replay-safety claim in the
 * repository at once, including the 36 that nobody has ever re-run.
 *
 * ## What "changes nothing" is measured with
 *
 * The catalogue, never rows. On a live workspace the worker tier writes
 * `job_queue` and the kv tables continuously, so a row count cannot answer "did
 * anything change" — and an instrument that cannot answer the question here
 * could not answer it there either. Column shapes, index definitions and
 * constraint definitions are written by DDL and by nothing else.
 *
 * Index and constraint *definitions* are in the digest, not just their names,
 * because `0258` claims something specific about them: that renaming a column
 * carries its constraints and indexes with it, since Postgres stores them
 * against the attribute rather than the name. That claim is worth checking, and
 * a digest of names alone would not notice if it were false.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from '@quackback/db/migrate'
import { BUNDLED_MIGRATIONS, MIGRATIONS_DIR } from '@quackback/db/schema-version'
import { REPLAY_OVERRIDES, assessReplaySafety } from '../replay-safety'

const ADMIN_URL =
  process.env.DRIFT_CHECK_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/postgres'
const SUFFIX = randomUUID().replace(/-/g, '').slice(0, 10)
const TEMPLATE = `qb_replay_tpl_${SUFFIX}`

let admin: postgres.Sql
const created: string[] = []

const dsnFor = (db: string) => ADMIN_URL.replace(/\/[^/]+$/, `/${db}`)

async function scratch(): Promise<string> {
  const name = `qb_replay_${SUFFIX}_${created.length}`
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

const sqlOf = (tag: string) => readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8')

/**
 * The migrations whose verdict is a promise about a second run, in journal
 * order. Derived from the classifier rather than listed, so a migration that
 * *becomes* `safe` is checked here without anyone remembering to add it.
 */
const REPLAY_SAFE = BUNDLED_MIGRATIONS.filter(
  (m) => assessReplaySafety(m.tag, sqlOf(m.tag)).verdict === 'safe'
).map((m) => m.tag)

/**
 * The `safe` verdicts this test measured and found false, read from
 * `REPLAY_OVERRIDES` rather than kept here.
 *
 * They used to be a list in this file, which meant the only code that knew two
 * verdicts were wrong was the code that could not act on it: the fleet
 * migrator's gap heal truncates a live ledger on the strength of a `safe`
 * verdict and had never heard of them. They now live on the classifier, which
 * refuses them at source, and this file's job changed with them — from
 * *recording* the finding to *re-earning* it.
 *
 * Both directions are checked below, and between them the list can only shrink
 * honestly:
 *
 * - Delete an entry and its migration returns to `REPLAY_SAFE`, where the first
 *   test replays it against a fully migrated database and it fails, by name. So
 *   an entry cannot be removed to make anything green.
 * - Keep an entry the classifier has learned to see for itself, or one whose
 *   replay no longer fails, and the second test names it as no longer earned.
 */
const OVERRIDDEN = REPLAY_OVERRIDES.map((o) => o.tag)

/**
 * Run one migration file the way drizzle would: split on its statement
 * breakpoints, execute each chunk in order.
 *
 * Deliberately **not** wrapped in a transaction that gets rolled back. A rolled
 * back second pass would leave the catalogue trivially identical and the
 * assertion below would be one of the checks that cannot fail. The effects have
 * to be real for "nothing moved" to mean anything.
 */
async function applyAgain(sql: postgres.Sql, tag: string): Promise<number> {
  const chunks = sqlOf(tag)
    .split('--> statement-breakpoint')
    .map((c) => c.trim())
    .filter((c) => c !== '')
  for (const chunk of chunks) await sql.unsafe(chunk).simple()
  return chunks.length
}

/**
 * A digest of everything DDL writes and nothing else writes.
 *
 * `pg_get_indexdef` / `pg_get_constraintdef` render the *definition*, so a
 * column rename that failed to carry an index or constraint with it shows up
 * here even though the index's own name never changed.
 */
async function catalogueDigest(db: string): Promise<string> {
  return withSql(db, async (sql) => {
    const rows = await sql.unsafe<{ digest: string }[]>(`
      SELECT md5(string_agg(x, '|' ORDER BY x)) AS digest FROM (
        SELECT 'col:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||
               coalesce(column_default,'')||':'||is_nullable AS x
          FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        UNION ALL
        SELECT 'idx:'||c.relname||':'||i.indisvalid||':'||pg_get_indexdef(i.indexrelid) AS x
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        UNION ALL
        SELECT 'con:'||n.nspname||'.'||con.conname||':'||pg_get_constraintdef(con.oid) AS x
          FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
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
  // The first of the two applications, and the full production path: extensions,
  // lineage, concurrent indexes, seed and verify. A second pass over a
  // half-built schema would be checking replay against a database no workspace
  // looks like.
  await runMigrations(dsnFor(TEMPLATE), {})
}, 300_000)

afterAll(async () => {
  for (const db of created) {
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => {})
  }
  await admin?.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`).catch(() => {})
  await admin?.end({ timeout: 5 }).catch(() => {})
}, 180_000)

describe('the second application of the lineage', () => {
  it('changes nothing about the catalogue', async () => {
    const db = await scratch()
    const before = await catalogueDigest(db)

    const applied: string[] = []
    const failures: string[] = []
    await withSql(db, async (sql) => {
      for (const tag of REPLAY_SAFE) {
        try {
          await applyAgain(sql, tag)
          applied.push(tag)
        } catch (error) {
          failures.push(`${tag}: ${(error as Error).message}`)
        }
      }
    })

    // Named, not counted: a run that refuses eight migrations should say which
    // eight, because the repair is per-file.
    expect(failures, `\n${failures.join('\n')}\n`).toEqual([])
    expect(await catalogueDigest(db)).toBe(before)

    // The guards against passing vacuously. If the classifier ever went blind
    // and called nothing safe, or `applyAgain` stopped producing chunks, both
    // assertions above would hold just as well over an empty second pass.
    // Counted in statements rather than files, and through the same tokenizer
    // the classifier uses, so "the pass ran" is measured the way the claim is.
    const statements = applied.reduce(
      (n, tag) => n + assessReplaySafety(tag, sqlOf(tag)).statementCount,
      0
    )
    // Floors, not measurements: they answer "did anything run", so they sit
    // well below the current 35 files / 90 statements rather than tracking them.
    expect(REPLAY_SAFE.length).toBeGreaterThan(30)
    expect(REPLAY_SAFE).toContain('0256_workspace_key_columns')
    expect(statements).toBeGreaterThan(50)

    // And the pass above only means anything because the overridden migrations
    // were never in it. This is the classifier's refusal arriving here rather
    // than a skip list in this file quietly standing in for it.
    for (const tag of OVERRIDDEN) expect(REPLAY_SAFE).not.toContain(tag)
  }, 300_000)

  it('re-earns every reviewed override, so the list can only shrink', async () => {
    // Three things have to hold for an entry to still be pulling its weight, and
    // dropping any one of them turns the override from a measurement into an
    // exemption nobody re-checks:
    //
    //   1. the shape reading still says `safe` — otherwise the classifier now
    //      sees the case unaided and the entry is dead weight;
    //   2. the override is what refuses it, so something downstream is actually
    //      being protected;
    //   3. the replay still fails, the way the entry says it does.
    const db = await scratch()
    const stale: string[] = []
    const unexpectedlyFine: string[] = []

    for (const override of REPLAY_OVERRIDES) {
      const report = assessReplaySafety(override.tag, sqlOf(override.tag))
      if (report.shapeVerdict !== 'safe') {
        stale.push(
          `${override.tag}: the classifier now reads this as ${report.shapeVerdict} on its own — ` +
            'delete the override'
        )
        continue
      }
      expect(report.verdict, override.tag).toBe(override.verdict)
      expect(report.override, override.tag).toBe(override)

      // Rolled back: this one is measuring that the replay fails, and a
      // half-applied drop would poison the rest of the loop.
      const error = await withSql(db, (sql) =>
        sql
          .begin(async (tx) => {
            await applyAgain(tx as unknown as postgres.Sql, override.tag)
          })
          .then(
            () => null,
            (e: Error) => e
          )
      )
      if (error === null) unexpectedlyFine.push(`${override.tag} — ${override.why}`)
      else expect(error.message, override.tag).toMatch(override.stillFailsWith)
    }

    expect(stale, `\n${stale.join('\n')}\n`).toEqual([])
    expect(unexpectedlyFine, `\n${unexpectedlyFine.join('\n')}\n`).toEqual([])

    // Every entry names a migration this build actually ships. A tag that has
    // been renamed or removed matches nothing in `assessReplaySafety`, so the
    // override would be silently inert rather than wrong.
    const bundled = new Set(BUNDLED_MIGRATIONS.map((m) => m.tag))
    expect(OVERRIDDEN.filter((tag) => !bundled.has(tag))).toEqual([])
  }, 120_000)

  it('is a check that can fail: replaying a migration outside that set errors', async () => {
    // Not a claim about the classifier — `errors` is its conservative bucket and
    // a file in it is allowed to succeed. This is a control on the harness: it
    // proves `applyAgain` really reaches the database, so the green above is a
    // measurement rather than a no-op that never executed anything.
    const db = await scratch()
    expect(assessReplaySafety('0000_initial', sqlOf('0000_initial')).verdict).toBe('errors')

    const error = await withSql(db, (sql) =>
      sql
        .begin(async (tx) => {
          await applyAgain(tx as unknown as postgres.Sql, '0000_initial')
          return null
        })
        .then(
          () => null,
          (e: Error) => e
        )
    )
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/already exists/i)
  }, 120_000)
})

describe('the guarded rename, both directions', () => {
  /**
   * The assertion that a rename this test performed is undone, rather than the
   * weaker one that a column happens to be present.
   *
   * `0258` is `safe` only because a `-- @replay: guarded-by` annotation says its
   * `DO` block is a no-op once the old names are gone. Two things have to be
   * true for that to be a claim worth honouring, and asserting only the second
   * would pass against a migration that does nothing at all:
   *
   * 1. it renames when the old name is there, and
   * 2. it does nothing when it is not.
   */
  it('renames a column this test renamed back, then leaves it alone', async () => {
    const db = await scratch()
    const migrated = await catalogueDigest(db)

    await withSql(db, (sql) =>
      sql.unsafe(`ALTER TABLE presence_stream RENAME COLUMN workspace_key TO tenant_id`)
    )
    const undone = await catalogueDigest(db)
    // The instrument sees a rename at all. Without this the two comparisons
    // below could both pass over a digest that reports the same string for
    // every schema.
    expect(undone).not.toBe(migrated)

    await withSql(db, (sql) => applyAgain(sql, '0256_workspace_key_columns'))
    expect(await catalogueDigest(db)).toBe(migrated)

    // And the second run over its own effects — the claim the annotation makes.
    await withSql(db, (sql) => applyAgain(sql, '0256_workspace_key_columns'))
    expect(await catalogueDigest(db)).toBe(migrated)
  }, 120_000)

  it('carries the primary key and the partial index with the renamed column', async () => {
    // `0258` says renaming carries constraints and indexes because Postgres
    // stores them against the attribute. Read back, rather than assumed: these
    // two are the ones whose definitions name the column.
    const db = await scratch()
    const defs = await withSql(db, (sql) =>
      sql.unsafe<{ name: string; def: string }[]>(`
        SELECT conname AS name, pg_get_constraintdef(oid) AS def
          FROM pg_constraint WHERE conname = 'kv_store_pkey'
        UNION ALL
        SELECT indexname AS name, indexdef AS def
          FROM pg_indexes WHERE indexname = 'presence_stream_agents_idx'
      `)
    )
    expect(defs).toHaveLength(2)
    for (const d of defs) {
      expect(d.def).toContain('workspace_key')
      expect(d.def).not.toContain('tenant_id')
    }
  }, 120_000)
})
