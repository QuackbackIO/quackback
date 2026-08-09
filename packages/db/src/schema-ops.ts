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
 * | {@link ensureConcurrentIndexes} | Never called by the runtime path at all. Without it the 4 HNSW and 3 trigram indexes silently do not exist: no error, just a slow tenant. |
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
import type postgres from 'postgres'

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
  kind: 'invalid_index' | 'missing_index' | 'missing_extension'
  detail: string
}

export interface PostconditionReport {
  ok: boolean
  violations: PostconditionViolation[]
  /** Everything observed, for the run log — reported whether or not it passed. */
  observed: {
    invalidIndexes: InvalidIndex[]
    missingIndexes: string[]
    extensions: string[]
  }
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
 * Three checks, and the first is deliberately not derived from anything:
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

  const violations: PostconditionViolation[] = [
    ...invalidIndexes.map(
      (i): PostconditionViolation => ({
        kind: 'invalid_index',
        detail: `${i.schema}.${i.name} on ${i.table} is INVALID (indisready=${i.isReady}${
          i.constraintBacked ? ', constraint-backed' : ''
        })`,
      })
    ),
    ...missingIndexes.map(
      (name): PostconditionViolation => ({
        kind: 'missing_index',
        detail: `${name} does not exist`,
      })
    ),
    ...missingExtensions.map(
      (name): PostconditionViolation => ({
        kind: 'missing_extension',
        detail: `extension ${name} is not installed`,
      })
    ),
  ]

  return {
    ok: violations.length === 0,
    violations,
    observed: { invalidIndexes, missingIndexes, extensions },
  }
}
