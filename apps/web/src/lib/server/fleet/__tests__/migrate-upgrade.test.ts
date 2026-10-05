/**
 * An unattended upgrade from the last release's schema, against a real Postgres.
 *
 * The boot path runs every pending migration in one transaction, so one row a
 * migration cannot handle rolls back the whole upgrade and the container
 * crash-loops on the same row forever. This file builds a database at the last
 * released schema (the journal truncated after `0125`), plants the data shapes
 * that used to abort or destroy, and runs the real executor over the rest.
 *
 * Each run gets its own scratch database and its own staged migrations folder,
 * so nothing depends on the shared `quackback_test`.
 */
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { runMigrations, type MigrationProgress } from '@quackback/db/migrate'
import { CONCURRENT_INDEX_SPECS } from '@quackback/db/schema-ops'
import { BUNDLED_MIGRATIONS, MIGRATIONS_DIR } from '@quackback/db/schema-version'

const ADMIN_URL =
  process.env.DRIFT_CHECK_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/postgres'
const RELEASED_TAG_PREFIX = '0125_'

function dsnFor(db: string): string {
  return ADMIN_URL.replace(/\/[^/]+$/, `/${db}`)
}

/** The bundled SQL with the journal cut after `lastTagPrefix`. */
function stageMigrations(lastTagPrefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'qb-mig-stage-'))
  mkdirSync(join(dir, 'meta'))
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (file.endsWith('.sql')) copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file))
  }
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')
  ) as { entries: { tag: string }[] }
  const cut = journal.entries.findIndex((e) => e.tag.startsWith(lastTagPrefix))
  if (cut < 0) throw new Error(`no ${lastTagPrefix} migration in the journal`)
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) })
  )
  return dir
}

const quiet = { onnotice: () => {} }
const coreOnly = {
  requireSessionMode: false,
  concurrentIndexes: false,
  seed: false,
  verify: false,
} as const

describe('upgrading a database at the last released schema', () => {
  const SCRATCH = `qb_mig_up_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let admin: postgres.Sql
  let sql: postgres.Sql
  let stage: string
  const pendingSeen: string[][] = []
  const events: MigrationProgress[] = []

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, ...quiet })
    await admin.unsafe(`CREATE DATABASE ${SCRATCH}`)
    sql = postgres(dsnFor(SCRATCH), { max: 1, ...quiet })
    stage = stageMigrations(RELEASED_TAG_PREFIX)
    await runMigrations(dsnFor(SCRATCH), { ...coreOnly, migrationsFolder: stage })

    // Data the released build could hold, in the shapes that used to abort or
    // destroy the upgrade. FK triggers are bypassed for the roadmap rows: their
    // posts and roadmaps would need the whole content graph, and the archive
    // only has to keep the rows.
    await sql.unsafe(`
      INSERT INTO settings (id, name, slug, created_at, widget_config, feature_flags)
      VALUES (gen_random_uuid(), 'Acme', 'acme', now(), '   ', '{not json')
    `)
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL session_replication_role = replica`)
      await tx.unsafe(`
        INSERT INTO post_roadmaps (post_id, roadmap_id, position)
        SELECT gen_random_uuid(), gen_random_uuid(), g FROM generate_series(1, 3) g
      `)
    })

    await runMigrations(dsnFor(SCRATCH), {
      requireSessionMode: false,
      onPending: ({ tags }) => pendingSeen.push(tags),
      onMigration: (e) => events.push(e),
    })
  }, 300_000)

  afterAll(async () => {
    await sql?.end({ timeout: 5 }).catch(() => {})
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`).catch(() => {})
    await admin?.end({ timeout: 5 }).catch(() => {})
    if (stage) rmSync(stage, { recursive: true, force: true })
  }, 60_000)

  it('reports every migration above the release as pending, then each one as it runs', () => {
    const cut = BUNDLED_MIGRATIONS.findIndex((m) => m.tag.startsWith(RELEASED_TAG_PREFIX))
    const expected = BUNDLED_MIGRATIONS.slice(cut + 1).map((m) => m.tag)
    expect(pendingSeen).toEqual([expected])

    const done = events.filter((e) => e.phase === 'done')
    expect(done.map((e) => e.tag)).toEqual(expected)
    expect(done.map((e) => e.index)).toEqual(expected.map((_, i) => i + 1))
    expect(done.every((e) => e.total === expected.length && e.durationMs! >= 0)).toBe(true)
    // Every start is answered by its done before the next start.
    expect(events.map((e) => e.phase)).toEqual(expected.flatMap(() => ['start', 'done']))
  })

  it('skips a blank widget_config and an unparseable feature_flags blob instead of aborting', async () => {
    const [row] = await sql.unsafe(`SELECT feature_flags FROM settings WHERE slug = 'acme'`)
    // Left exactly as stored; the app reads it as default flags.
    expect(row!.feature_flags).toBe('{not json')
    const [macros] = await sql.unsafe(`SELECT count(*)::int AS n FROM macros`)
    expect(macros!.n).toBe(0)
  })

  it('archives curated roadmap rows as inert data instead of dropping them', async () => {
    const [legacy] = await sql.unsafe(`SELECT to_regclass('post_roadmaps')::text AS t`)
    expect(legacy!.t).toBeNull()
    const [rows] = await sql.unsafe(`SELECT count(*)::int AS n FROM post_roadmaps_archived`)
    expect(rows!.n).toBe(3)

    const fks = await sql.unsafe(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'post_roadmaps_archived'::regclass AND contype = 'f'`
    )
    expect(fks).toEqual([])
    const indexes = await sql.unsafe(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'post_roadmaps_archived' ORDER BY indexname`
    )
    expect(indexes.map((r) => r.indexname)).toEqual([
      'post_roadmaps_archived_pk',
      'post_roadmaps_archived_position_idx',
      'post_roadmaps_archived_post_id_idx',
      'post_roadmaps_archived_roadmap_id_idx',
    ])
  })

  it('builds every concurrent index after the transaction, valid', async () => {
    const rows = await sql.unsafe<{ name: string; valid: boolean }[]>(
      `SELECT c.relname AS name, i.indisvalid AS valid
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = ANY($1::text[])`,
      [CONCURRENT_INDEX_SPECS.map((s) => s.name)]
    )
    expect(rows.map((r) => r.name).sort()).toEqual(CONCURRENT_INDEX_SPECS.map((s) => s.name).sort())
    expect(rows.every((r) => r.valid)).toBe(true)
  })

  it('reports nothing pending on the next start', async () => {
    const pending: string[][] = []
    await runMigrations(dsnFor(SCRATCH), {
      ...coreOnly,
      onPending: ({ tags }) => pending.push(tags),
    })
    expect(pending).toEqual([[]])
  })
})

describe('a fresh install', () => {
  const SCRATCH = `qb_mig_fresh_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let admin: postgres.Sql
  let sql: postgres.Sql

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, ...quiet })
    await admin.unsafe(`CREATE DATABASE ${SCRATCH}`)
    sql = postgres(dsnFor(SCRATCH), { max: 1, ...quiet })
    await runMigrations(dsnFor(SCRATCH), { ...coreOnly })
  }, 300_000)

  afterAll(async () => {
    await sql?.end({ timeout: 5 }).catch(() => {})
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`).catch(() => {})
    await admin?.end({ timeout: 5 }).catch(() => {})
  }, 60_000)

  it('has no roadmap archive, because there was nothing to keep', async () => {
    const [row] = await sql.unsafe(`SELECT to_regclass('post_roadmaps_archived')::text AS t`)
    expect(row!.t).toBeNull()
  })

  it('builds no HNSW or trigram index inside the migration transaction', async () => {
    // concurrentIndexes: false above, so anything present came from a migration.
    const rows = await sql.unsafe(
      `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`,
      [CONCURRENT_INDEX_SPECS.filter((s) => s.concurrent).map((s) => s.name)]
    )
    expect(rows).toEqual([])
  })
})
