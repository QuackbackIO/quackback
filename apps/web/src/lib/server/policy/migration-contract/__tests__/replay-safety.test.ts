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

/**
 * The `-- @replay: guarded-by …` claim.
 *
 * The annotation exists so a human can assert the one thing this file cannot
 * see: that a `DO` block's body is guarded and therefore a no-op on a second
 * run. Every test here is about the ways that claim must NOT work, because the
 * only interesting question about an escape hatch is how narrow it is. The
 * claim being honoured at all is one case; the other six are refusals.
 */
describe('assessReplaySafety — the vouched-for DO block', () => {
  const GUARDED = `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_attribute WHERE attname = 'a') THEN
      ALTER TABLE "t" RENAME COLUMN "a" TO "b";
    END IF; END $$;`

  it('is mutates without the annotation, and safe with it', () => {
    // Both halves in one test on purpose: the annotation's whole effect is the
    // difference between these two, and a test that only asserted the second
    // would pass just as well if the DO block had never been dangerous.
    expect(assess(GUARDED).verdict).toBe('mutates')

    const vouchedFor = assess(`-- @replay: guarded-by the old column still existing\n${GUARDED}`)
    expect(vouchedFor.verdict).toBe('safe')
    expect(vouchedFor.mutating).toEqual([])
    // The claim is carried into the report rather than absorbed into a verdict
    // that silently got kinder — a migrator log can say whose claim this was.
    expect(vouchedFor.vouched).toHaveLength(1)
    expect(vouchedFor.vouched[0]!.reason).toBe('the old column still existing')
  })

  it('cannot launder a write this scanner can read for itself', () => {
    // The property that keeps the annotation from being a general-purpose
    // override: attached to an INSERT, it does not merely fail to help — it is
    // reported, so a misuse cannot sit unnoticed in a file that passes anyway.
    const r = assess(`-- @replay: guarded-by nothing at all\nINSERT INTO "t" ("id") VALUES ('a');`)
    expect(r.verdict).toBe('mutates')
    expect(r.mutating.some((m) => /may only vouch for a DO block/.test(m.reason))).toBe(true)
    expect(r.vouched).toEqual([])
  })

  it.each([
    ['no `guarded-by`', '-- @replay: safe', /malformed @replay annotation/],
    ['`guarded-by` with no rationale', '-- @replay: guarded-by', /malformed @replay annotation/],
    ['a near-miss keyword', '-- @replay: guarded by the column', /malformed @replay annotation/],
  ])('refuses %s', (_name, annotation, reason) => {
    const r = assess(`${annotation}\n${GUARDED}`)
    expect(r.verdict).toBe('mutates')
    expect(r.mutating.some((m) => reason.test(m.reason))).toBe(true)
  })

  it('refuses an annotation that sits below the statement it means to cover', () => {
    const r = assess(`${GUARDED}\n-- @replay: guarded-by the old column still existing`)
    expect(r.verdict).toBe('mutates')
    expect(r.mutating.some((m) => /vouches for no statement/.test(m.reason))).toBe(true)
  })

  it('refuses an annotation buried inside the block it means to cover', () => {
    // A natural authoring mistake, and it has to fail: an annotation inside a
    // dollar-quoted body is exactly the text this file has decided not to read.
    const r = assess(`DO $$ BEGIN
      -- @replay: guarded-by the old column still existing
      PERFORM 1;
    END $$;`)
    expect(r.verdict).toBe('mutates')
    expect(r.mutating.some((m) => /vouches for no statement/.test(m.reason))).toBe(true)
  })

  it('does not read a claim out of a string literal or a block comment', () => {
    const r = assess(
      `COMMENT ON TABLE "t" IS '-- @replay: guarded-by a lie';\n` +
        `/* -- @replay: guarded-by another lie */\n${GUARDED}`
    )
    expect(r.verdict).toBe('mutates')
    expect(r.vouched).toEqual([])
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

  it('reports the line the SQL starts on, not the line the file does', () => {
    // `stripNoise` blanks a header comment to spaces rather than deleting it, so
    // a statement under one begins after a long run of whitespace. Reporting
    // that as line 1 mislocates the finding in every migration in this
    // repository (all of them open with prose), and it is what an annotation's
    // "directly above this statement" window is measured against.
    const sql = `-- a header\n-- that runs on\n\nSELECT 1;\nUPDATE "t" SET x = 1;`
    expect(splitStatements(stripNoise(sql)).map((s) => [s.line, s.endLine])).toEqual([
      [4, 4],
      [5, 5],
    ])
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

  it('0258 is safe, and its safety is a claim rather than a shape', () => {
    // The one migration in the corpus whose verdict rests on an annotation. If
    // the annotation is ever dropped, moved, or the guard unwrapped, this goes
    // red here before the fleet migrator refuses a heal in production.
    const r = assessReplaySafety(
      '0258_workspace_key_columns',
      readFileSync(join(MIGRATIONS_DIR, '0258_workspace_key_columns.sql'), 'utf8')
    )
    expect(r.verdict).toBe('safe')
    expect(r.vouched).toHaveLength(1)
    expect(r.vouched[0]!.excerpt).toMatch(/^DO \$\$/)
  })

  it('no other migration leans on a @replay claim', () => {
    // The annotation is an escape hatch, so how many statements are through it
    // is a number worth watching. A second one is not forbidden — it just has
    // to be noticed and argued for here rather than accumulating quietly.
    //
    // 0263 (two blocks), 0266, 0267 and 0269 are argued for on the same grounds
    // as 0258: each is a `DO $$` whose body is guarded by
    // `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '<name>')`,
    // and whose only action is adding the constraint of that exact name. The
    // guard and the action name the same object, so a second run does nothing.
    // A DO block is the only shape the scanner will accept a claim for, because
    // it is the only one whose body it cannot read — the claim is about the
    // guard, not a request to be trusted about a statement.
    //
    // 0266 and 0267 were rewritten into that shape rather than merely annotated:
    // both were a bare `ADD CONSTRAINT`, which Postgres has no IF NOT EXISTS
    // form of, so the guard had to be written before there was anything to
    // vouch for. The claim describes the guard now in the file.
    //
    // They are annotated rather than left refused because their verdicts sit
    // inside the fleet's gap-heal window: while they read as `mutates`, a heal
    // of any hole below them is refused, which is the capability
    // `migrator-gap-heal.test.ts` exercises.
    const vouching = files.filter(
      (f) => assessReplaySafety(f, readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).vouched.length > 0
    )
    expect(vouching).toEqual([
      '0258_workspace_key_columns.sql',
      '0263_connectors.sql',
      '0266_channel_threads.sql',
      '0267_channel_threads_conversation_fk.sql',
      '0269_event_dispatch_owner.sql',
    ])
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
