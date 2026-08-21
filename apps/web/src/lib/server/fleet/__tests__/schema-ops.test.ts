/**
 * The steps that run outside drizzle's migration transaction, against a real
 * Postgres.
 *
 * The property this file exists for is not obvious and cannot be mocked:
 * **`CREATE INDEX CONCURRENTLY IF NOT EXISTS` treats an INVALID index as
 * present.** It emits a notice, skips the build and returns success — so
 * "re-run the migrator" does not heal an invalid index, it certifies one. That
 * is measured here rather than asserted, because the whole heal ordering
 * (drop, *then* build) rests on it being true.
 *
 * Two notes on method:
 *
 * - The invalid index is produced by flipping `pg_index.indisvalid`, which is a
 *   catalogue-level stand-in for an interrupted build. Its **fidelity is
 *   established elsewhere**: `FLEET-MIGRATIONS.md` records a real
 *   `CREATE INDEX CONCURRENTLY` killed mid-flight producing exactly this
 *   catalogue state. A unit test that had to race a real build would be timing
 *   dependent; the live kill is the evidence, this is the regression net.
 * - Each run gets its own scratch database, so nothing depends on the shared
 *   `quackback_test` and no assertion counts rows it does not own.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import {
  dropInvalidIndexes,
  listInvalidIndexes,
  verifySchemaPostconditions,
  CONCURRENT_INDEX_SPECS,
  REQUIRED_EXTENSIONS,
} from '@quackback/db/schema-ops'

const ADMIN_URL =
  process.env.DRIFT_CHECK_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/postgres'
const SCRATCH = `qb_p10_ops_${randomUUID().replace(/-/g, '').slice(0, 12)}`

let admin: postgres.Sql
let sql: postgres.Sql

async function invalidate(indexName: string) {
  await sql.unsafe(
    `UPDATE pg_index SET indisvalid = false WHERE indexrelid = '${indexName}'::regclass`
  )
}

beforeAll(async () => {
  admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE ${SCRATCH}`)
  sql = postgres(ADMIN_URL.replace(/\/[^/]+$/, `/${SCRATCH}`), { max: 2, onnotice: () => {} })
}, 60_000)

afterAll(async () => {
  await sql?.end({ timeout: 5 }).catch(() => {})
  await admin?.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`).catch(() => {})
  await admin?.end({ timeout: 5 }).catch(() => {})
}, 60_000)

beforeEach(async () => {
  await sql.unsafe(`DROP TABLE IF EXISTS widgets CASCADE`)
  await sql.unsafe(`CREATE TABLE widgets (id serial PRIMARY KEY, name text, code text UNIQUE)`)
  await sql.unsafe(
    `INSERT INTO widgets (name, code) SELECT 'w'||g, 'c'||g FROM generate_series(1,50) g`
  )
})

describe('the reason the heal has to come first', () => {
  it('CREATE INDEX CONCURRENTLY IF NOT EXISTS SKIPS an invalid index and reports success', async () => {
    await sql.unsafe(`CREATE INDEX widgets_name_idx ON widgets (name)`)
    await invalidate('widgets_name_idx')
    expect((await listInvalidIndexes(sql)).map((i) => i.name)).toEqual(['widgets_name_idx'])

    // The migrator's own build step, verbatim in shape. It succeeds.
    await sql.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS widgets_name_idx ON widgets (name)`)

    // ...and the index is still invalid. This is the whole defect: a migrator
    // built on `IF NOT EXISTS` alone exits 0 having repaired nothing, forever.
    expect((await listInvalidIndexes(sql)).map((i) => i.name)).toEqual(['widgets_name_idx'])
  })

  it('dropping first makes the same build actually rebuild it, valid', async () => {
    await sql.unsafe(`CREATE INDEX widgets_name_idx ON widgets (name)`)
    await invalidate('widgets_name_idx')

    const healed = await dropInvalidIndexes(sql)
    expect(healed.dropped.map((i) => i.name)).toEqual(['widgets_name_idx'])
    expect(healed.skipped).toEqual([])

    await sql.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS widgets_name_idx ON widgets (name)`)
    expect(await listInvalidIndexes(sql)).toEqual([])
    const [row] = await sql.unsafe(
      `SELECT indisvalid FROM pg_index WHERE indexrelid = 'widgets_name_idx'::regclass`
    )
    expect(row!.indisvalid).toBe(true)
  })
})

describe('dropInvalidIndexes', () => {
  it('leaves a constraint-backed invalid index alone, and says so', async () => {
    // DROP INDEX cannot remove one ("constraint ... requires it"), and an
    // invalid index there means a failed ADD CONSTRAINT ... USING INDEX, which
    // is a different repair. Guessing at it automatically would be worse than
    // reporting it.
    await invalidate('widgets_code_key')
    const healed = await dropInvalidIndexes(sql)
    expect(healed.dropped).toEqual([])
    expect(healed.skipped.map((i) => i.name)).toEqual(['widgets_code_key'])
    expect(healed.skipped[0]!.constraintBacked).toBe(true)
    // Still there — nothing was silently destroyed to make the sweep pass.
    expect((await listInvalidIndexes(sql)).map((i) => i.name)).toEqual(['widgets_code_key'])
  })

  it('is a no-op on a healthy database', async () => {
    await sql.unsafe(`CREATE INDEX widgets_name_idx ON widgets (name)`)
    expect(await dropInvalidIndexes(sql)).toEqual({ dropped: [], skipped: [] })
  })

  it('finds an invalid index with no name it was told to look for', async () => {
    // The derivation-free half. `widgets_adhoc_idx` is in no list anywhere; the
    // sweep sees it because it asks the catalogue rather than a set of expected
    // names.
    await sql.unsafe(`CREATE INDEX widgets_adhoc_idx ON widgets (name, code)`)
    await invalidate('widgets_adhoc_idx')
    expect((await listInvalidIndexes(sql)).map((i) => i.name)).toEqual(['widgets_adhoc_idx'])
  })
})

describe('verifySchemaPostconditions', () => {
  it('reports an invalid index as a violation', async () => {
    await sql.unsafe(`CREATE INDEX widgets_name_idx ON widgets (name)`)
    await invalidate('widgets_name_idx')
    const report = await verifySchemaPostconditions(sql)
    expect(report.ok).toBe(false)
    expect(report.violations.some((v) => v.kind === 'invalid_index')).toBe(true)
    expect(report.violations.find((v) => v.kind === 'invalid_index')!.detail).toContain(
      'widgets_name_idx'
    )
  })

  it('reports every concurrent index as missing on a database that has none', async () => {
    const report = await verifySchemaPostconditions(sql)
    expect(report.ok).toBe(false)
    const missing = report.violations.filter((v) => v.kind === 'missing_index')
    expect(missing).toHaveLength(CONCURRENT_INDEX_SPECS.length)
  })

  it('reports every required extension as missing when none is installed', async () => {
    const report = await verifySchemaPostconditions(sql)
    const missingExt = report.violations.filter((v) => v.kind === 'missing_extension')
    expect(missingExt.map((v) => v.detail)).toEqual(
      REQUIRED_EXTENSIONS.map((e) => `extension ${e} is not installed`)
    )
  })

  it('derives what must exist from the creator list, not from a second list', async () => {
    // A hand-maintained "expected indexes" list would drift the day someone
    // added a spec. This asserts the two are the same object, so they cannot.
    const report = await verifySchemaPostconditions(sql)
    expect(report.observed.missingIndexes).toEqual(CONCURRENT_INDEX_SPECS.map((s) => s.name))
  })
})
