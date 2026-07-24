/**
 * Migration drift check: proves the hand-written SQL migrations and the
 * Drizzle TS schema describe the same database.
 *
 * How it works:
 *   1. Creates a scratch database (dropped first if it exists).
 *   2. Applies every migration in drizzle/ via the drizzle-orm migrator,
 *      exactly like production boot does.
 *   3. Diffs the resulting live schema against src/schema via drizzle-kit's
 *      programmatic push API (pushSchema). An empty statement list means the
 *      two are in sync.
 *   4. Filters the statements through an explicit exemption list for DDL that
 *      raw SQL legitimately owns and Drizzle cannot express (partitioning,
 *      extensions). Anything left is drift and fails the check.
 *
 * The scratch database is always dropped, including on failure.
 *
 * Usage: bun run scripts/check-drift.ts  (or: bun run db:check-drift)
 * Env:   DRIFT_CHECK_DATABASE_URL - postgres server to borrow for the scratch
 *        DB (default postgresql://postgres:password@localhost:5432/postgres).
 *        Needs CREATEDB rights; the named database itself is never touched.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { getTableConfig } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import * as schema from '../src/schema'
import { runMigrations } from '../src/migrate-runtime'

/**
 * drizzle-kit 0.31's programmatic pushSchema has two blockers for this use
 * case, patched in memory at module load (node_modules stays pristine):
 *
 * 1. Its DB shim drops query params, breaking introspection of composite-PK
 *    tables (the PK-name query binds $1/$2). Fix: inline params as literals.
 * 2. Ambiguous create+delete pairs open an interactive rename prompt, which
 *    rejects without a TTY. A checker never applies changes, so renames are
 *    irrelevant: force every conflict prompt down its non-interactive
 *    "all created + all deleted" early return and let the diff report both
 *    sides as drift.
 *
 * Each patch asserts its target text so an upstream change fails loudly
 * instead of silently un-patching.
 */
const KIT_PATCHES: { find: string; replace: string }[] = [
  {
    // Boundary-anchored so $1 can never clobber the prefix of $10+.
    find: 'const res = await drizzleInstance.execute(sql.raw(query));',
    replace:
      'const res = await drizzleInstance.execute(sql.raw((params ?? []).reduce(' +
      '(q, p, i) => q.replace(new RegExp("\\\\$" + (i + 1) + "\\\\b", "g"), "\'" + String(p).replaceAll("\'", "\'\'") + "\'"), query)));',
  },
  // Conflict-prompt guards: make the "nothing to resolve" early return
  // unconditional. The Items guard covers tables and other named entities;
  // the other two cover columns and schemas.
  {
    find: 'if (missingItems.length === 0 || newItems.length === 0) {',
    replace: 'if (true) {',
  },
  {
    find: 'if (newColumns.length === 0 || missingColumns.length === 0) {',
    replace: 'if (true) {',
  },
  {
    find: 'if (missingSchemas.length === 0 || newSchemas.length === 0) {',
    replace: 'if (true) {',
  },
]

Bun.plugin({
  name: 'drizzle-kit-pushschema-fixes',
  setup(build) {
    build.onLoad({ filter: /drizzle-kit[/\\]api\.mjs$/ }, async (args) => {
      let code = await Bun.file(args.path).text()
      for (const { find, replace } of KIT_PATCHES) {
        if (!code.includes(find)) {
          throw new Error(
            `drizzle-kit api.mjs no longer contains: ${find}\n` +
              'The pushSchema patches in check-drift.ts may be obsolete (fixed upstream?); review them.'
          )
        }
        code = code.replaceAll(find, replace)
      }
      return { contents: code, loader: 'js' }
    })
  },
})

const { pushSchema } = await import('drizzle-kit/api')

const ADMIN_URL =
  process.env.DRIFT_CHECK_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/postgres'
const SCRATCH_DB = 'quackback_drift_check'

/**
 * DDL that the raw SQL migrations own on purpose and the TS schema cannot
 * declare. Every entry needs a reason; an entry that stops matching anything
 * is reported so the list cannot rot.
 */
const EXEMPTIONS: { reason: string; pattern: RegExp }[] = [
  {
    // page_views is declaratively day-partitioned (0137); drizzle-kit's
    // introspection does not see partitioned parents (relkind 'p'), so the
    // diff wants to create the table and its indexes from scratch. The
    // migration owns this DDL; the TS declaration exists for query typing.
    reason: 'page_views is a partitioned parent, invisible to introspection',
    pattern: /^CREATE (?:TABLE|INDEX "page_views_\w+_idx" ON) "page_views"/,
  },
  {
    // Partition children are created by 0137 and the daily maintenance job;
    // they are intentionally undeclared in TS. The diff wants them dropped
    // (with the RLS-disable pgSuggestions pairs with every drop).
    reason: 'page_views day-partition children are created dynamically',
    pattern: /^(?:DROP TABLE|ALTER TABLE) "page_views_\d{8}"/,
  },
  {
    // sweep_lock (0077) is an advisory-lock table used only through raw SQL
    // (apps/web/src/lib/server/sweep-lock.ts); it has no TS schema on purpose.
    reason: 'sweep_lock is a raw-SQL advisory-lock table, not part of the ORM schema',
    pattern: /^(?:DROP TABLE|ALTER TABLE) "sweep_lock"/,
  },
  {
    // drizzle-kit introspects an empty array default ('{}'::text[]) as '{""}',
    // so it always thinks this default changed. Semantically identical.
    reason: 'drizzle-kit false positive: empty array default reads back as \'{""}\'',
    pattern:
      /^ALTER TABLE "invitation" ALTER COLUMN "magic_link_tokens" SET DEFAULT '\{\}'::text\[\];?$/,
  },
  {
    // Composite partial unique index mixing a plain column with a jsonb ->>
    // expression (0210). drizzle-kit introspects the expression member with an
    // implicit ::text cast the TS declaration cannot render, so it re-emits
    // the pair on every diff. The migration owns the real DDL; the TS
    // declaration exists so the schema documents the dedupe contract.
    reason:
      'inbound-delivery dedupe index: jsonb ->> expression member does not round-trip introspection, drizzle-kit re-emits the CREATE',
    pattern:
      /^CREATE UNIQUE INDEX "conversation_messages_inbound_delivery_key_idx" ON "conversation_messages" USING btree /,
  },
  {
    // Drop half of the spurious pair for the same index.
    reason:
      'inbound-delivery dedupe index: jsonb ->> expression member does not round-trip introspection, drizzle-kit re-emits the DROP',
    pattern: /^DROP INDEX "conversation_messages_inbound_delivery_key_idx"/,
  },
  {
    // GIN pg_trgm index for the inbox message-content ILIKE search (0139,
    // narrowed to partial in 0209). It is declared in TS, but drizzle-kit cannot
    // introspect the gin_trgm_ops opclass, so it reads the index as absent and
    // wants to create it. The migration owns the real DDL.
    reason:
      'pg_trgm GIN index for inbox content search; gin_trgm_ops opclass is not introspectable, so drizzle-kit re-emits the CREATE',
    pattern:
      /^CREATE INDEX "conversation_messages_content_trgm_idx" ON "conversation_messages" USING gin /,
  },
  {
    // Drop half of the spurious pair for the same partial gin_trgm index.
    reason:
      'pg_trgm GIN index for inbox content search; drizzle-kit cannot round-trip the partial gin_trgm index, so it re-emits the DROP',
    pattern: /^DROP INDEX "conversation_messages_content_trgm_idx"/,
  },
  {
    // GIN pg_trgm index on principal.display_name for the inbox visitor-name
    // ILIKE search (0139, narrowed to partial in 0209). Same gin_trgm_ops
    // introspection limitation as above.
    reason:
      'pg_trgm GIN index on principal.display_name for inbox name search; gin_trgm_ops opclass is not introspectable, so drizzle-kit re-emits the CREATE',
    pattern: /^CREATE INDEX "principal_display_name_trgm_idx" ON "principal" USING gin /,
  },
  {
    // Drop half of the spurious pair for the same partial gin_trgm index.
    reason:
      'pg_trgm GIN index on principal.display_name for inbox name search; drizzle-kit cannot round-trip the partial gin_trgm index, so it re-emits the DROP',
    pattern: /^DROP INDEX "principal_display_name_trgm_idx"/,
  },
  {
    // GIN pg_trgm index on user.name for the admin people-search ILIKE match.
    // Same gin_trgm_ops introspection limitation as the two indexes above.
    reason:
      'pg_trgm GIN index on user.name for admin people search; gin_trgm_ops opclass is not introspectable, so drizzle-kit re-emits the CREATE',
    pattern: /^CREATE INDEX "user_name_trgm_idx" ON "user" USING gin /,
  },
  {
    // Drop half of the same spurious pair — drizzle-kit reads the gin_trgm_ops
    // index as unmatched and wants to drop it. The migration owns the real DDL.
    reason:
      'pg_trgm GIN index on user.name for admin people search; drizzle-kit cannot round-trip the gin_trgm index, so it re-emits the DROP',
    pattern: /^DROP INDEX "user_name_trgm_idx"/,
  },
  {
    // Case-insensitive unique index on lower(name) (0156). drizzle-kit cannot
    // express a functional/expression index, so it reads the index as undeclared
    // and wants to drop it. The plain unique on name is declared in TS separately.
    reason: 'conversation_tags unique on lower(name) is an expression index, not expressible in TS',
    pattern: /^DROP INDEX "conversation_tags_name_lower_key"/,
  },
  {
    // HNSW cosine indexes over embedding columns (migrations 0203 + 0209).
    // drizzle-kit cannot round-trip an hnsw partial index (vector_cosine_ops
    // opclass + partial predicate), so it emits a spurious drop/create pair for
    // every one. Each listed index is created by a migration, so a genuinely
    // unmigrated hnsw index (a new, unlisted name) still fails the check.
    reason:
      'hnsw vector_cosine_ops partial index is not faithfully round-tripped by drizzle-kit; drop half of the spurious pair',
    pattern:
      /^DROP INDEX "(posts|kb_articles|feedback_signals|feedback_suggestions|assistant_snippets|conversation_summaries|ticket_summaries|changelog)_embedding_hnsw_idx"/,
  },
  {
    reason:
      'hnsw vector_cosine_ops partial index is not faithfully round-tripped by drizzle-kit; create half of the spurious pair',
    pattern:
      /^CREATE INDEX "(posts|kb_articles|feedback_signals|feedback_suggestions|assistant_snippets|conversation_summaries|ticket_summaries|changelog)_embedding_hnsw_idx" ON "\w+" USING hnsw /,
  },
  {
    // Same empty text[] default false positive as invitation.magic_link_tokens
    // above: '{}'::text[] reads back as '{""}', so drizzle-kit always thinks the
    // default changed. Semantically identical. (apps, 0193.)
    reason: 'drizzle-kit false positive: empty text[] default reads back as \'{""}\'',
    pattern:
      /^ALTER TABLE "apps" ALTER COLUMN "(granted_scopes|subscribed_event_types)" SET DEFAULT '\{\}';?$/,
  },
  {
    // The settings.assistant_config jsonb default (0204) is byte-identical in TS,
    // but postgres normalizes the stored jsonb literal (spacing/formatting) so
    // drizzle-kit's introspected default never string-matches the TS default.
    reason:
      'drizzle-kit false positive: jsonb default is normalized by postgres and no longer string-matches TS',
    pattern:
      /^ALTER TABLE "settings" ALTER COLUMN "assistant_config" SET DEFAULT '\{"version":3,.*\}'::jsonb;?$/,
  },
]

function scratchUrl(): string {
  const url = new URL(ADMIN_URL)
  url.pathname = `/${SCRATCH_DB}`
  return url.toString()
}

/**
 * Direct catalog check for the one table pushSchema cannot see: compares
 * page_views' live columns and indexes (parent only, children excluded)
 * against the TS declaration by name.
 */
async function pageViewsCatalogDrift(scratch: ReturnType<typeof postgres>): Promise<string[]> {
  const cfg = getTableConfig(schema.pageViews)
  const drift: string[] = []

  const liveCols = new Set(
    (
      await scratch`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${cfg.name}`
    ).map((r) => r.column_name as string)
  )
  const declaredCols = new Set(cfg.columns.map((c) => c.name))
  for (const c of declaredCols) {
    if (!liveCols.has(c))
      drift.push(`page_views: TS declares column "${c}" the migrations never created`)
  }
  for (const c of liveCols) {
    if (!declaredCols.has(c))
      drift.push(`page_views: live column "${c}" is missing from the TS declaration`)
  }

  const liveIdx = new Set(
    (
      await scratch`SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ${cfg.name}`
    ).map((r) => r.indexname as string)
  )
  const declaredIdx = new Set(cfg.indexes.map((i) => i.config.name).filter(Boolean) as string[])
  if (cfg.primaryKeys.length > 0 || cfg.columns.some((c) => c.primary)) {
    declaredIdx.add(`${cfg.name}_pkey`)
  }
  for (const i of declaredIdx) {
    if (!liveIdx.has(i))
      drift.push(`page_views: TS declares index "${i}" the migrations never created`)
  }
  for (const i of liveIdx) {
    if (!declaredIdx.has(i))
      drift.push(`page_views: live index "${i}" is missing from the TS declaration`)
  }

  return drift
}

async function main(): Promise<number> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} })
  let scratch: ReturnType<typeof postgres> | undefined
  try {
    console.log(`Recreating scratch database ${SCRATCH_DB}...`)
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`)
    await admin.unsafe(`CREATE DATABASE ${SCRATCH_DB}`)

    // max: 8 — pushSchema introspects all tables concurrently; a single
    // connection would serialize its ~5 catalog queries per table.
    scratch = postgres(scratchUrl(), { max: 8, onnotice: () => {} })
    const db = drizzle(scratch, { schema })

    // pgvector must exist before migrations run (mirrors src/migrate.ts).
    await scratch`CREATE EXTENSION IF NOT EXISTS vector`

    console.log('Applying all migrations to the scratch database...')
    // The same code path production boot uses (migrate + system seed); the
    // seed's DML cannot affect the DDL diff.
    await runMigrations(scratchUrl())

    console.log('Diffing live schema against the Drizzle TS schema...')
    // pushSchema reads `.rows` off execute() results, but the postgres-js
    // driver returns a bare array; adapt the shape it expects.
    const kitDb = {
      execute: async (query: unknown) => {
        const res: unknown = await db.execute(query as Parameters<typeof db.execute>[0])
        return Array.isArray(res) ? { rows: res } : res
      },
    } as unknown as Parameters<typeof pushSchema>[1]
    const { statementsToExecute } = await pushSchema(schema, kitDb)

    const drift: string[] = []
    const used = new Set<number>()
    for (const statement of statementsToExecute) {
      const hit = EXEMPTIONS.findIndex((e) => e.pattern.test(statement))
      if (hit === -1) drift.push(statement)
      else used.add(hit)
    }

    // A stale exemption is a failure, not a warning: nobody reads warnings
    // on green builds, and the list is meant not to rot.
    const stale = EXEMPTIONS.filter((_, i) => !used.has(i))
    for (const exemption of stale) {
      console.error(
        `STALE EXEMPTION (matched nothing, remove it): ${exemption.pattern} (${exemption.reason})`
      )
    }

    // The partitioned parent is invisible to pushSchema introspection
    // (exemption 1), so its column/index drift is asserted directly against
    // the catalog instead of staying a documented blind spot.
    drift.push(...(await pageViewsCatalogDrift(scratch)))

    if (stale.length > 0) return 1
    if (drift.length > 0) {
      console.error(`\nDRIFT DETECTED: ${drift.length} statement(s) separate the migrations`)
      console.error('from the TS schema. Fix the side that is wrong (see packages/db/README.md);')
      console.error('if the DDL is legitimately SQL-only, add an exemption in this script.\n')
      for (const statement of drift) console.error(`  ${statement}`)
      return 1
    }

    console.log('No drift: migrations and TS schema are in sync.')
    return 0
  } finally {
    if (scratch) await scratch.end()
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`)
    } catch (error) {
      console.warn(`Failed to drop ${SCRATCH_DB}:`, error)
    }
    await admin.end()
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('Drift check failed to run:', error)
    process.exit(1)
  }
)
