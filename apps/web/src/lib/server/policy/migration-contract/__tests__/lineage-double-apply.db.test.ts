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
 * `0258_workspace_key_columns` is `safe` only because a human wrote
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
import { assessReplaySafety } from '../replay-safety'

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
 * `safe` verdicts this test measured and found false, the first time anything
 * ran the lineage twice.
 *
 * Both are the same defect, and it is a defect in the classifier rather than in
 * these two files: `assessReplaySafety` reads one migration in isolation, so it
 * judges `DROP … IF EXISTS` and `CREATE INDEX IF NOT EXISTS` against the schema
 * that file expects. A replay happens against the schema the **whole lineage**
 * produced, in which a later migration may have recreated the object one of
 * them drops or dropped the table one of them indexes.
 *
 * They are recorded rather than fixed because closing the hole means teaching
 * the classifier about object lifetimes across 234 files, which is not a change
 * to make as a side effect of a rename. What is not deferred is knowing about
 * them: the second test below re-runs each one and fails if it ever stops
 * failing, so this list can only shrink, and it cannot rot into a set of
 * exemptions nobody has re-checked.
 *
 * `0091` is the one that matters. Its verdict is `safe`, which is the strict
 * bucket `gapHealVerdict` demands before it truncates a ledger — and the
 * statement it is vouching for is `DROP TABLE IF EXISTS conversation_tags`
 * against a database where `0127` put that table back. It fails here only
 * because a foreign key happens to depend on the table. Nothing in the
 * classifier makes that luck; a `DROP … IF EXISTS` that succeeds on replay is
 * the `mutates` class, not the `safe` one.
 */
const KNOWN_FALSE_SAFE_CLAIMS: { tag: string; error: RegExp; why: string }[] = [
  {
    tag: '0091_drop_conversation_tags',
    error: /conversation_tags/,
    why: '0127 recreates the table this drops, so a replay drops a live table rather than skipping',
  },
  {
    tag: '0207_index_tuning',
    error: /pipeline_log/,
    why: '0217 drops the table this indexes, so IF NOT EXISTS has no relation to check against',
  },
]
const FALSE_SAFE_TAGS = new Set(KNOWN_FALSE_SAFE_CLAIMS.map((c) => c.tag))

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
        if (FALSE_SAFE_TAGS.has(tag)) continue
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
    expect(REPLAY_SAFE).toContain('0258_workspace_key_columns')
    expect(statements).toBeGreaterThan(50)
  }, 300_000)

  it('still fails on every claim already known to be false', async () => {
    // The list only shrinks. An entry that stopped failing would mean either
    // the classifier learned to see the case (delete the entry) or the file
    // changed under it (look again) — and either way, leaving it here would
    // turn a measured finding into an exemption nobody re-checks.
    const db = await scratch()
    const unexpectedlyFine: string[] = []
    for (const claim of KNOWN_FALSE_SAFE_CLAIMS) {
      expect(REPLAY_SAFE, `${claim.tag} is no longer classified safe`).toContain(claim.tag)
      // Rolled back: this one is measuring that the replay fails, and a
      // half-applied drop would poison the rest of the loop.
      const error = await withSql(db, (sql) =>
        sql
          .begin(async (tx) => {
            await applyAgain(tx as unknown as postgres.Sql, claim.tag)
          })
          .then(
            () => null,
            (e: Error) => e
          )
      )
      if (error === null) unexpectedlyFine.push(`${claim.tag} (${claim.why})`)
      else expect(error.message, claim.tag).toMatch(claim.error)
    }
    expect(unexpectedlyFine, `\n${unexpectedlyFine.join('\n')}\n`).toEqual([])
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

    await withSql(db, (sql) => applyAgain(sql, '0258_workspace_key_columns'))
    expect(await catalogueDigest(db)).toBe(migrated)

    // And the second run over its own effects — the claim the annotation makes.
    await withSql(db, (sql) => applyAgain(sql, '0258_workspace_key_columns'))
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
