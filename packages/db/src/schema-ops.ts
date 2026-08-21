/**
 * The schema steps that live *outside* drizzle's migration transaction.
 *
 * `migrate()` wraps the whole migration loop in one `session.transaction()`
 * (drizzle-orm@0.45.2), so the lineage is atomic: measured kills at 1.0/1.5/2.0/
 * 2.5 s leave `applied=0, tables=0` and kills at 3.0/3.5 s leave `226/147`,
 * never a partial. That is a real property and a reconciler can inherit it.
 *
 * **But only `migrate()` is atomic.** Extension creation, the concurrent index
 * builds and `seedSystemData()` all run outside that transaction, so a kill in
 * the tail leaves every migration applied *and* the database wrong. The ledger
 * will happily report success. Everything in this module exists because of that
 * gap:
 *
 * | Step | Why it is here |
 * | --- | --- |
 * | {@link ensureExtensions} | `runMigrations()` never issued `CREATE EXTENSION vector`, and no migration file does either, while `0000_initial` declares `vector` columns. A fresh database migrated through the runtime path could not succeed at all. |
 * | {@link dropInvalidIndexes} | An interrupted `CREATE INDEX CONCURRENTLY` leaves an *invalid* index. `IF NOT EXISTS` then treats it as present, so the next run skips it and exits 0 — leaving it INVALID forever. Healing has to happen *before* the build, not by re-running and hoping. |
 * | {@link ensureConcurrentIndexes} | Never called by the runtime path at all. Without it the 4 HNSW and 3 trigram indexes silently do not exist: no error, just a slow workspace. |
 * | {@link verifySchemaPostconditions} | The ledger is not evidence. Post-conditions have to be checked against the catalogue, independently of what `drizzle.__drizzle_migrations` claims. |
 *
 * ## Why this module exists as a module
 *
 * `ensureConcurrentIndexes` used to be a private function inside `migrate.ts`,
 * and `migrate.ts` calls `runMigrations()` at its top level — so importing it to
 * reuse the function ran migrations as a side effect. Any migrator role built on
 * it had to either shell out to the CLI or duplicate the index list. Both were
 * worse than moving the steps into a leaf module that `migrate.ts` imports: one
 * list, two consumers, no duplication to drift.
 *
 * Everything here takes a `postgres.Sql` rather than a `Database`, because
 * `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block and the
 * drizzle wrapper is not the right handle for a statement with that constraint.
 */
import { is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import type postgres from 'postgres'
import * as schema from './schema'

/**
 * Arbitrary application-chosen key identifying "quackback migrations" for
 * Postgres advisory locks. Any int8-range value works as long as it is stable
 * across processes; this one is just a readable literal. Cast explicitly to
 * bigint at the call site since it exceeds Postgres' int4 range and postgres-js
 * has no bigint parameter type.
 *
 * `pg_advisory_lock` is session-scoped, so it requires a session-mode
 * connection: through a transaction-mode pooler the lock is taken and released
 * on whichever backend happened to serve the statement, which is not a lock.
 */
export const MIGRATION_LOCK_KEY = 4_820_231_099
/** 32-bit namespace for the two-key lock (per-database via hashtext). */
export const MIGRATION_LOCK_NS = 48_202

/** Extensions the bundled schema depends on. `vector` is load-bearing from `0000_initial`. */
export const REQUIRED_EXTENSIONS = ['vector', 'pg_trgm'] as const

/**
 * The indexes that cannot be built inside the migration transaction.
 *
 * One list, three consumers: the creator, the post-condition check and the
 * heal. A new HNSW or trigram index added here is automatically verified,
 * which is the property a second hand-maintained "expected indexes" list would
 * not have.
 *
 * `concurrent: false` marks the one that genuinely cannot be built
 * concurrently: `page_views` is range-partitioned (0137) and Postgres rejects
 * `CREATE INDEX CONCURRENTLY` on a partitioned parent. It is still verified
 * like the others.
 */
export interface ConcurrentIndexSpec {
  name: string
  concurrent: boolean
  ddl: string
}

export const CONCURRENT_INDEX_SPECS: readonly ConcurrentIndexSpec[] = [
  {
    name: 'posts_embedding_hnsw_idx',
    concurrent: true,
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_embedding_hnsw_idx ON posts USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL',
  },
  {
    name: 'kb_articles_embedding_hnsw_idx',
    concurrent: true,
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS kb_articles_embedding_hnsw_idx ON kb_articles USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL',
  },
  {
    name: 'assistant_snippets_embedding_hnsw_idx',
    concurrent: true,
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS assistant_snippets_embedding_hnsw_idx ON assistant_snippets USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL',
  },
  {
    name: 'conversation_summaries_embedding_hnsw_idx',
    concurrent: true,
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_summaries_embedding_hnsw_idx ON conversation_summaries USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL',
  },
  {
    name: 'principal_display_name_trgm_idx',
    concurrent: true,
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS principal_display_name_trgm_idx ON principal USING gin (display_name gin_trgm_ops) WHERE display_name IS NOT NULL',
  },
  {
    name: 'conversation_messages_content_trgm_idx',
    concurrent: true,
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_messages_content_trgm_idx ON conversation_messages USING gin (content gin_trgm_ops) WHERE deleted_at IS NULL',
  },
  {
    name: 'user_name_trgm_idx',
    concurrent: true,
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS user_name_trgm_idx ON "user" USING gin (name gin_trgm_ops)',
  },
  {
    // page_views is range-partitioned (0137); Postgres rejects CREATE INDEX
    // CONCURRENTLY on a partitioned parent ("cannot create index on partitioned
    // table ... concurrently"). Built non-concurrently on the parent, matching
    // how 0137 creates the table's other parent indexes; the index recurses to
    // existing partitions.
    name: 'page_views_principal_id_idx',
    concurrent: false,
    ddl: 'CREATE INDEX IF NOT EXISTS page_views_principal_id_idx ON page_views (principal_id) WHERE principal_id IS NOT NULL',
  },
]

/** Create the extensions the bundled schema needs. Idempotent. */
export async function ensureExtensions(sql: postgres.Sql): Promise<void> {
  for (const ext of REQUIRED_EXTENSIONS) {
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS ${ext}`)
  }
}

export interface InvalidIndex {
  schema: string
  name: string
  table: string
  /**
   * `indisready` tells the two interruption points apart. A `CREATE INDEX
   * CONCURRENTLY` killed in its first phase leaves `indisvalid=false,
   * indisready=false`; killed in the final validation phase it leaves
   * `indisvalid=false, indisready=true`. Both are unusable; both are reported.
   */
  isReady: boolean
  /** True when a constraint owns this index, so `DROP INDEX` would be refused. */
  constraintBacked: boolean
}

/**
 * Every invalid index in the database, found by asking the catalogue rather
 * than by checking a list of names we expect to exist.
 *
 * That distinction is the whole point. A name list only sees the indexes whose
 * names someone remembered to write down; `pg_index.indisvalid` sees every
 * index in the database, including ones a future migration adds and ones a
 * partition inherited.
 */
export async function listInvalidIndexes(sql: postgres.Sql): Promise<InvalidIndex[]> {
  const rows = await sql.unsafe<
    { schema: string; name: string; table: string; isready: boolean; constraint_backed: boolean }[]
  >(`
    SELECT n.nspname                    AS schema,
           ic.relname                   AS name,
           tc.relname                   AS table,
           i.indisready                 AS isready,
           EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
                                        AS constraint_backed
      FROM pg_index i
      JOIN pg_class ic     ON ic.oid = i.indexrelid
      JOIN pg_class tc     ON tc.oid = i.indrelid
      JOIN pg_namespace n  ON n.oid = ic.relnamespace
     WHERE NOT i.indisvalid
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     ORDER BY n.nspname, ic.relname
  `)
  return rows.map((r) => ({
    schema: r.schema,
    name: r.name,
    table: r.table,
    isReady: r.isready,
    constraintBacked: r.constraint_backed,
  }))
}

export interface DropInvalidResult {
  dropped: InvalidIndex[]
  /** Constraint-backed invalid indexes, which `DROP INDEX` cannot remove. */
  skipped: InvalidIndex[]
}

/**
 * Drop invalid, non-constraint indexes so the build that follows actually
 * rebuilds them.
 *
 * This has to run **before** `ensureConcurrentIndexes`, and that ordering is
 * the entire fix. `CREATE INDEX CONCURRENTLY IF NOT EXISTS` treats an invalid
 * index as present: it emits a notice, skips the build, and returns success. So
 * "re-run the migrator" does not heal an invalid index — it certifies it. The
 * migrator would exit 0 with an index that can never be used by the planner and
 * will never be repaired, and nothing anywhere would say so.
 *
 * Constraint-backed indexes are reported rather than dropped. `DROP INDEX`
 * refuses them ("cannot drop index ... because constraint ... requires it"), and
 * an invalid one there means a failed `ALTER TABLE ... ADD CONSTRAINT ... USING
 * INDEX` — a different repair, and not one to guess at automatically.
 */
export async function dropInvalidIndexes(sql: postgres.Sql): Promise<DropInvalidResult> {
  const invalid = await listInvalidIndexes(sql)
  const dropped: InvalidIndex[] = []
  const skipped: InvalidIndex[] = []
  for (const idx of invalid) {
    if (idx.constraintBacked) {
      skipped.push(idx)
      continue
    }
    // Quoted identifiers: these names come from the catalogue, not from input,
    // but an unquoted mixed-case or reserved name would still fail to resolve.
    await sql.unsafe(`DROP INDEX IF EXISTS "${idx.schema}"."${idx.name}"`)
    dropped.push(idx)
  }
  return { dropped, skipped }
}

/**
 * Build the indexes that cannot live inside the migration transaction.
 *
 * Not idempotent in the way it looks: `IF NOT EXISTS` skips an *invalid* index
 * as readily as a valid one, which is why {@link dropInvalidIndexes} must have
 * run first.
 */
export async function ensureConcurrentIndexes(sql: postgres.Sql): Promise<void> {
  for (const spec of CONCURRENT_INDEX_SPECS) {
    await sql.unsafe(spec.ddl)
  }
}

export interface PostconditionViolation {
  kind: 'invalid_index' | 'missing_index' | 'missing_extension' | 'missing_table' | 'missing_column'
  detail: string
}

/**
 * Exactly what {@link verifySchemaPostconditions} looks at, carried in its own
 * report.
 *
 * A verdict is only as good as its scope, and this one used to have no way to
 * state its scope: it returned `ok: true` for a workspace whose `settings.cloud`
 * column did not exist and which 500'd on every page, because it checked
 * extensions and the concurrent indexes and nothing else while its name promised
 * the schema. Naming the checks in the report means a reader of a green verdict
 * can see what green did and did not mean, without reading this file.
 */
export const POSTCONDITION_CHECKS = [
  'no invalid index in any user schema',
  'every concurrent index present',
  'every required extension installed',
  'every table this build declares exists',
  'every column this build declares exists',
] as const

export interface PostconditionReport {
  ok: boolean
  violations: PostconditionViolation[]
  /** What was checked. See {@link POSTCONDITION_CHECKS}. */
  covers: readonly string[]
  /** Everything observed, for the run log — reported whether or not it passed. */
  observed: {
    invalidIndexes: InvalidIndex[]
    missingIndexes: string[]
    extensions: string[]
    /** Declared tables absent from the database, as `schema.table`. */
    missingTables: string[]
    /** Declared columns absent from an existing table, as `schema.table.column`. */
    missingColumns: string[]
  }
}

interface DeclaredTable {
  schema: string
  name: string
  columns: string[]
}

/**
 * The tables and columns this build's Drizzle schema declares.
 *
 * Derived from the schema object the running code queries with, never from a
 * hand-written list — which is the property that makes it worth having. Drizzle
 * emits explicit column lists, so `findFirst()` on a table missing a declared
 * column *throws* rather than returning a null; the set of columns this function
 * returns is therefore the set whose absence takes a page down.
 */
export function declaredTables(): DeclaredTable[] {
  // The schema barrel also exports enums, relations and plain constants, and its
  // table types are each distinct literal-named generics, so a type predicate
  // over the union does not narrow. `is()` is the runtime check; the cast only
  // reunifies what it already established.
  return (Object.values(schema) as unknown[])
    .filter((v) => is(v, PgTable))
    .map((value) => {
      const config = getTableConfig(value as PgTable)
      return {
        schema: config.schema ?? 'public',
        name: config.name,
        columns: config.columns.map((c) => c.name),
      }
    })
}

/**
 * Verify the database, not the ledger.
 *
 * `drizzle.__drizzle_migrations` records that a migration *ran*. It cannot
 * record that the objects still exist, that a concurrent build finished, or
 * that anything since has dropped one. A run interrupted in the tail leaves a
 * complete ledger and a broken database, so a checker that consults the ledger
 * is a checker that agrees with the failure.
 *
 * Four checks, and none of them is derived from a hand-written list:
 *
 * 1. **The `indisvalid` sweep.** Every index in every user schema. No list of
 *    expected names, so it catches invalid indexes this module has never heard
 *    of — a future migration's, a partition's, an operator's.
 * 2. **Presence of the concurrent indexes.** The one thing the sweep cannot see:
 *    an index that was never built is not invalid, it is absent, and absence is
 *    silent. Derived from {@link CONCURRENT_INDEX_SPECS} — the same list the
 *    creator uses, so it cannot drift out of step with it.
 * 3. **Extensions.** A dropped `vector` makes every embedding column
 *    unqueryable while the ledger still reads complete.
 * 4. **The shape this build queries with.** Every table and column
 *    {@link declaredTables} names must exist. Added because checks 1–3 returned
 *    `ok: true` on a workspace whose `settings.cloud` column was absent and which
 *    500'd on every page: the ledger said complete, the post-conditions said
 *    correct, and the workspace was down. Drizzle emits explicit column lists, so a
 *    declared column that does not exist is not a missing value, it is a throw.
 *
 * **What it still does not cover, stated so a green verdict is readable.** Types,
 * nullability, defaults, constraints, triggers and functions are not compared,
 * and objects the database has but this build does not declare are ignored on
 * purpose — a workspace a newer image has already migrated past must keep being
 * served (§10.2), so extra is never a violation. Full bidirectional comparison
 * is what `db:check-drift` is for, and it needs the Drizzle Kit toolchain rather
 * than a query.
 */
export async function verifySchemaPostconditions(sql: postgres.Sql): Promise<PostconditionReport> {
  const invalidIndexes = await listInvalidIndexes(sql)

  const present = await sql.unsafe<{ relname: string }[]>(`
    SELECT ic.relname
      FROM pg_class ic
      JOIN pg_namespace n ON n.oid = ic.relnamespace
     WHERE ic.relkind IN ('i', 'I')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  `)
  const presentNames = new Set(present.map((r) => r.relname))
  const missingIndexes = CONCURRENT_INDEX_SPECS.filter((s) => !presentNames.has(s.name)).map(
    (s) => s.name
  )

  const extRows = await sql.unsafe<{ extname: string }[]>(`SELECT extname FROM pg_extension`)
  const extensions = extRows.map((r) => r.extname).sort()
  const missingExtensions = REQUIRED_EXTENSIONS.filter((e) => !extensions.includes(e))

  const columnRows = await sql.unsafe<
    { table_schema: string; table_name: string; column_name: string }[]
  >(`
    SELECT table_schema, table_name, column_name
      FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  `)
  const columnsByTable = new Map<string, Set<string>>()
  for (const row of columnRows) {
    const key = `${row.table_schema}.${row.table_name}`
    let cols = columnsByTable.get(key)
    if (!cols) columnsByTable.set(key, (cols = new Set()))
    cols.add(row.column_name)
  }
  const missingTables: string[] = []
  const missingColumns: string[] = []
  for (const table of declaredTables()) {
    const key = `${table.schema}.${table.name}`
    const present = columnsByTable.get(key)
    if (!present) {
      missingTables.push(key)
      continue
    }
    for (const column of table.columns) {
      if (!present.has(column)) missingColumns.push(`${key}.${column}`)
    }
  }

  const violations: PostconditionViolation[] = [
    ...invalidIndexes.map((i): PostconditionViolation => ({
      kind: 'invalid_index',
      detail: `${i.schema}.${i.name} on ${i.table} is INVALID (indisready=${i.isReady}${
        i.constraintBacked ? ', constraint-backed' : ''
      })`,
    })),
    ...missingIndexes.map((name): PostconditionViolation => ({
      kind: 'missing_index',
      detail: `${name} does not exist`,
    })),
    ...missingExtensions.map((name): PostconditionViolation => ({
      kind: 'missing_extension',
      detail: `extension ${name} is not installed`,
    })),
    ...missingTables.map((name): PostconditionViolation => ({
      kind: 'missing_table',
      detail: `table ${name} is declared by this build and does not exist`,
    })),
    ...missingColumns.map((name): PostconditionViolation => ({
      kind: 'missing_column',
      detail:
        `column ${name} is declared by this build and does not exist; every query this ` +
        'build issues against that table names it explicitly and will throw',
    })),
  ]

  return {
    ok: violations.length === 0,
    violations,
    covers: POSTCONDITION_CHECKS,
    observed: { invalidIndexes, missingIndexes, extensions, missingTables, missingColumns },
  }
}
