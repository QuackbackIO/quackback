/**
 * The replay-safety classifier.
 *
 * Run against the real 228 bundled migrations as well as synthetic fixtures,
 * because the question it answers is about *this* corpus: which of the
 * migrations a reconciler might replay against a database whose ledger is
 * behind its own schema would change data if it ran twice.
 *
 * The direction that matters is stated once here and then tested: a statement
 * mis-classified into `errors` costs nothing, because `migrate()` is
 * transactional and the run rolls back whole. A statement mis-classified *out
 * of* `mutates` is the real defect, so the `mutates` cases are the ones with
 * the most fixtures.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assessReplaySafety, splitStatements } from '../replay-safety'
import { stripNoise } from '../scan'

// Same relative walk `ledger.test.ts` uses, so both scanners read one corpus.
const MIGRATIONS_DIR = join(__dirname, '../../../../../../../../packages/db/drizzle')

function assess(sql: string) {
  return assessReplaySafety('fixture', sql)
}

describe('assessReplaySafety — safe shapes', () => {
  it.each([
    ['ADD COLUMN IF NOT EXISTS', 'ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "x" text;'],
    ['CREATE TABLE IF NOT EXISTS', 'CREATE TABLE IF NOT EXISTS "t" ("id" text);'],
    ['CREATE INDEX IF NOT EXISTS', 'CREATE INDEX IF NOT EXISTS "i" ON "t" ("id");'],
    [
      'CREATE UNIQUE INDEX IF NOT EXISTS',
      'CREATE UNIQUE INDEX IF NOT EXISTS "i" ON "t" ("id") WHERE "id" IS NOT NULL;',
    ],
    ['DROP TABLE IF EXISTS', 'DROP TABLE IF EXISTS "t";'],
    ['COMMENT ON', `COMMENT ON COLUMN "settings"."x" IS 'hello';`],
    [
      'CREATE OR REPLACE FUNCTION',
      'CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $fn$ BEGIN RETURN NULL; END; $fn$ LANGUAGE plpgsql;',
    ],
    ['INSERT ... ON CONFLICT', `INSERT INTO "t" ("id") VALUES ('a') ON CONFLICT DO NOTHING;`],
  ])('%s is safe', (_name, sql) => {
    expect(assess(sql).verdict).toBe('safe')
  })

  it('treats DROP TRIGGER IF EXISTS + CREATE TRIGGER as a total overwrite', () => {
    const sql = `
      DROP TRIGGER IF EXISTS "trg" ON "t";
      CREATE TRIGGER "trg" AFTER INSERT ON "t" FOR EACH ROW EXECUTE FUNCTION f();
    `
    expect(assess(sql).verdict).toBe('safe')
  })

  it('does NOT treat a bare CREATE TRIGGER as safe', () => {
    const sql = 'CREATE TRIGGER "trg" AFTER INSERT ON "t" FOR EACH ROW EXECUTE FUNCTION f();'
    expect(assess(sql).verdict).toBe('errors')
  })
})

describe('assessReplaySafety — the dangerous class', () => {
  it.each([
    ['bare INSERT', `INSERT INTO "t" ("id") VALUES ('a');`],
    ['UPDATE', `UPDATE "t" SET "x" = 1;`],
    ['DELETE', `DELETE FROM "t" WHERE "x" = 1;`],
    ['TRUNCATE', 'TRUNCATE "t";'],
    ['CTE write', `WITH c AS (INSERT INTO "t" ("id") VALUES ('a') RETURNING id) SELECT * FROM c;`],
    ['DO block', `DO $$ BEGIN UPDATE "t" SET x = 1; END $$;`],
    ['SELECT INTO', 'SELECT * INTO "copy" FROM "t";'],
  ])('%s is mutates', (_name, sql) => {
    expect(assess(sql).verdict).toBe('mutates')
  })

  it('an opaque DO block is refused rather than reasoned about', () => {
    // Its body could be anything; a classifier that peeked inside would be
    // claiming to parse plpgsql, which this deliberately does not.
    const r = assess(`DO $$ BEGIN PERFORM 1; END $$;`)
    expect(r.verdict).toBe('mutates')
    expect(r.mutating[0]!.reason).toMatch(/opaque/)
  })
})

describe('assessReplaySafety — tokenizer reuse', () => {
  it('ignores DDL keywords inside comments and string literals', () => {
    const sql = `
      -- UPDATE "t" SET x = 1;
      /* DELETE FROM "t"; */
      ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "x" text; -- INSERT INTO y
      COMMENT ON COLUMN "settings"."x" IS 'this mentions UPDATE and DELETE FROM';
    `
    expect(assess(sql).verdict).toBe('safe')
  })

  it('keeps a dollar-quoted body whole rather than splitting on its semicolons', () => {
    const sql = `CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.a = 1 THEN RETURN NULL; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;`
    expect(splitStatements(stripNoise(sql))).toHaveLength(1)
  })
})

describe('the real corpus', () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  it('scans every bundled migration and finds all three classes', () => {
    // Asserting it found migrations at all, so it cannot pass by scanning
    // nothing — the shape this run has caught nineteen times.
    expect(files.length).toBeGreaterThan(200)
    const counts = { safe: 0, errors: 0, mutates: 0 }
    const empty: string[] = []
    let statements = 0
    for (const f of files) {
      const r = assessReplaySafety(f, readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
      counts[r.verdict] += 1
      statements += r.statementCount
      if (r.statementCount === 0) empty.push(f)
    }
    expect(counts.safe).toBeGreaterThan(0)
    expect(counts.errors).toBeGreaterThan(0)
    expect(counts.mutates).toBeGreaterThan(0)
    // A tokenizer that stopped finding statements would classify the whole
    // corpus `safe` and quietly wave every replay through, so the statement
    // total is pinned rather than just the verdict spread.
    expect(statements).toBeGreaterThan(1000)
    // Exactly one bundled migration genuinely has no statements — 0012 is a
    // comment-only no-op that exists to keep the drizzle snapshots in step. Any
    // other file reaching zero is a tokenizer regression, not a no-op.
    expect(empty).toEqual(['0012_green_northstar.sql'])
  })

  it('0251 and 0253 — the two this fleet must replay — are safe', () => {
    // These are the migrations five live workspace databases carry without a
    // ledger row, so the reconciler will replay exactly these. If either ever
    // stops being replay-safe, healing those databases stops being free and
    // this test is where that is noticed.
    for (const tag of ['0251_settings_cloud_tenant_id', '0253_job_queue']) {
      const r = assessReplaySafety(tag, readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8'))
      expect(r.verdict).toBe('safe')
      expect(r.mutating).toEqual([])
      expect(r.erroring).toEqual([])
    }
  })

  it('0006 — a CTE INSERT — is caught as mutating', () => {
    const r = assessReplaySafety(
      '0006_thick_arclight',
      readFileSync(join(MIGRATIONS_DIR, '0006_thick_arclight.sql'), 'utf8')
    )
    expect(r.verdict).toBe('mutates')
  })

  it('0000_initial is errors, not mutates — atomicity, not danger', () => {
    // Every fresh workspace replays it. Classifying it as dangerous would refuse
    // provisioning; classifying it as safe would be a lie. It errors, which is
    // both true and harmless under a transactional migrate().
    const r = assessReplaySafety(
      '0000_initial',
      readFileSync(join(MIGRATIONS_DIR, '0000_initial.sql'), 'utf8')
    )
    expect(r.verdict).toBe('errors')
  })
})
