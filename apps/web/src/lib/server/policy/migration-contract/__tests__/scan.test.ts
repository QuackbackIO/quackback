import { describe, it, expect } from 'vitest'
import { scanMigrationFile, stripNoise } from '../scan'

describe('stripNoise', () => {
  it('blanks line comments but keeps line count stable', () => {
    const out = stripNoise('SELECT 1;\n-- a comment\nSELECT 2;\n')
    expect(out.split('\n').length).toBe(4)
    expect(out).not.toContain('comment')
  })

  it('blanks string literals, including doubled-quote escapes', () => {
    const out = stripNoise(`SET x = 'a''b DROP COLUMN c';`)
    expect(out).not.toContain('DROP COLUMN')
  })

  it('an apostrophe inside a line comment does not open a string literal', () => {
    // Without comment-then-string ordering this would swallow everything up
    // to the next real quote, hiding whatever DDL follows.
    const out = stripNoise(`-- the customer's request\nALTER TABLE "x" DROP COLUMN "y";`)
    expect(out).toContain('DROP COLUMN')
  })

  it('leaves dollar-quoted DO-block bodies untouched (DDL inside still executes)', () => {
    const out = stripNoise('DO $$\nBEGIN\n  ALTER TABLE "x" DROP COLUMN "y";\nEND $$;')
    expect(out).toContain('DROP COLUMN')
  })

  it('blanks block comments', () => {
    const out = stripNoise('/* DROP COLUMN mentioned here */\nSELECT 1;')
    expect(out).not.toContain('DROP COLUMN')
  })

  it('an apostrophe inside a block comment does not open a string literal', () => {
    const out = stripNoise(`/* we don't drop this yet */\nALTER TABLE "x" DROP COLUMN "y";`)
    expect(out).toContain('DROP COLUMN')
  })

  it('handles nested block comments (Postgres, unlike standard SQL, allows nesting)', () => {
    const out = stripNoise('/* outer /* inner DROP COLUMN z */ still outer */\nSELECT 1;')
    expect(out).not.toContain('DROP COLUMN')
  })

  it('a block comment does not swallow real code that follows it', () => {
    const out = stripNoise('/* note */\nALTER TABLE "x" DROP COLUMN "y";')
    expect(out).toContain('DROP COLUMN')
  })
})

describe('scanMigrationFile: destructive DDL detection', () => {
  it('detects DROP COLUMN', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" DROP COLUMN "legacy_slug";`
    )
    expect(findings).toEqual([
      { kind: 'drop_column', line: 1, table: 'posts', detail: 'legacy_slug' },
    ])
  })

  it('detects DROP COLUMN IF EXISTS', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" DROP COLUMN IF EXISTS "legacy_slug";`
    )
    expect(findings).toEqual([
      { kind: 'drop_column', line: 1, table: 'posts', detail: 'legacy_slug' },
    ])
  })

  it('detects every clause in a comma-separated multi-clause ALTER TABLE', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "x" DROP COLUMN "a", DROP COLUMN "b";`
    )
    expect(findings.map((f) => f.detail)).toEqual(['a', 'b'])
  })

  it('detects DROP TABLE, with and without IF EXISTS / CASCADE', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `DROP TABLE "widgets";\nDROP TABLE IF EXISTS "gadgets" CASCADE;`
    )
    expect(findings).toEqual([
      { kind: 'drop_table', line: 1, table: 'widgets', detail: 'widgets' },
      { kind: 'drop_table', line: 2, table: 'gadgets', detail: 'gadgets' },
    ])
  })

  it('detects DROP CONSTRAINT', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" DROP CONSTRAINT "posts_author_fk";`
    )
    expect(findings).toEqual([
      { kind: 'drop_constraint', line: 1, table: 'posts', detail: 'posts_author_fk' },
    ])
  })

  it('detects RENAME COLUMN', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" RENAME COLUMN "old_name" TO "new_name";`
    )
    expect(findings).toEqual([
      { kind: 'rename_column', line: 1, table: 'posts', detail: 'old_name -> new_name' },
    ])
  })

  it('detects a bare table RENAME TO', () => {
    const { findings } = scanMigrationFile('t.sql', `ALTER TABLE "old_tbl" RENAME TO "new_tbl";`)
    expect(findings).toEqual([
      { kind: 'rename_table', line: 1, table: 'old_tbl', detail: 'old_tbl -> new_tbl' },
    ])
  })

  it('does NOT flag ALTER INDEX ... RENAME TO (index names are not application-visible)', () => {
    const { findings } = scanMigrationFile('t.sql', `ALTER INDEX "old_idx" RENAME TO "new_idx";`)
    expect(findings).toEqual([])
  })

  it('does NOT flag RENAME CONSTRAINT (constraint names are not application-visible)', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" RENAME CONSTRAINT "old_fk" TO "new_fk";`
    )
    expect(findings).toEqual([])
  })

  it('detects ALTER COLUMN ... SET NOT NULL', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" ALTER COLUMN "title" SET NOT NULL;`
    )
    expect(findings).toEqual([{ kind: 'set_not_null', line: 1, table: 'posts', detail: 'title' }])
  })

  it('does NOT flag DROP NOT NULL (loosening a constraint is backward compatible)', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" ALTER COLUMN "title" DROP NOT NULL;`
    )
    expect(findings).toEqual([])
  })

  it('detects ALTER COLUMN ... TYPE and the SET DATA TYPE spelling', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "kb_articles" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);\n` +
        `ALTER TABLE "posts" ALTER COLUMN "title" TYPE varchar(50);`
    )
    expect(findings).toEqual([
      { kind: 'alter_type', line: 1, table: 'kb_articles', detail: 'embedding' },
      { kind: 'alter_type', line: 2, table: 'posts', detail: 'title' },
    ])
  })

  it('detects ALTER COLUMN ... DROP DEFAULT', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "conversations" ALTER COLUMN "channel" DROP DEFAULT;`
    )
    expect(findings).toEqual([
      { kind: 'drop_default', line: 1, table: 'conversations', detail: 'channel' },
    ])
  })

  it('does NOT flag SET DEFAULT (only dropping a default is destructive)', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "conversations" ALTER COLUMN "channel" SET DEFAULT 'messenger';`
    )
    expect(findings).toEqual([])
  })

  it('does NOT flag DROP INDEX (performance, not correctness)', () => {
    const { findings } = scanMigrationFile('t.sql', `DROP INDEX "posts_title_idx";`)
    expect(findings).toEqual([])
  })

  it('does NOT flag ADD CONSTRAINT ... CHECK', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" ADD CONSTRAINT "posts_status_check" CHECK ("status" IN ('open', 'closed'));`
    )
    expect(findings).toEqual([])
  })

  it('does NOT flag additive DDL (ADD COLUMN, CREATE TABLE, CREATE INDEX)', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `CREATE TABLE "widgets" ("id" uuid PRIMARY KEY);\n` +
        `ALTER TABLE "widgets" ADD COLUMN "name" text;\n` +
        `CREATE INDEX "widgets_name_idx" ON "widgets" ("name");`
    )
    expect(findings).toEqual([])
  })

  it('ignores DDL-shaped words inside a line comment', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `-- we used to DROP COLUMN legacy_slug here, no longer\nALTER TABLE "posts" ADD COLUMN "new_col" text;`
    )
    expect(findings).toEqual([])
  })

  it('ignores DDL-shaped words inside a string literal default value', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "settings" ALTER COLUMN "notes" SET DEFAULT 'Remember: DROP COLUMN is dangerous';`
    )
    expect(findings).toEqual([])
  })

  it('still finds destructive DDL nested inside a DO $$ ... $$ block', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `DO $$\nBEGIN\n  ALTER TABLE "x" DROP COLUMN "y";\nEND $$;`
    )
    expect(findings).toEqual([{ kind: 'drop_column', line: 3, table: 'x', detail: 'y' }])
  })

  it('ignores DDL-shaped words inside a block comment', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `/* 0032 did ALTER TABLE "posts" DROP COLUMN "dismiss_reason" */\nALTER TABLE "posts" ADD COLUMN "new_col" text;`
    )
    expect(findings).toEqual([])
  })

  it('finds real DDL after a block comment whose prose contains an apostrophe', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `/* we don't drop this yet */\nALTER TABLE "posts" DROP COLUMN "legacy_slug";`
    )
    expect(findings).toEqual([
      { kind: 'drop_column', line: 2, table: 'posts', detail: 'legacy_slug' },
    ])
  })

  it('detects DROP VIEW and DROP MATERIALIZED VIEW', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `DROP VIEW "posts_summary";\nDROP MATERIALIZED VIEW IF EXISTS "posts_stats";`
    )
    expect(findings).toEqual([
      { kind: 'drop_view', line: 1, table: 'posts_summary', detail: 'posts_summary' },
      { kind: 'drop_view', line: 2, table: 'posts_stats', detail: 'posts_stats' },
    ])
  })

  it('detects DROP TYPE', () => {
    const { findings } = scanMigrationFile('t.sql', `DROP TYPE "post_status" CASCADE;`)
    expect(findings).toEqual([
      { kind: 'drop_type', line: 1, table: 'post_status', detail: 'post_status' },
    ])
  })
})

/**
 * Postgres makes `COLUMN` optional in `DROP [COLUMN]`, `ALTER [COLUMN] ...`,
 * and `RENAME [COLUMN] ... TO`. A migration author who writes the shorthand
 * is exactly as destructive as one who writes the long form; the scanner
 * must catch both. Making `COLUMN` optional creates a real ambiguity —
 * `DROP x` and `DROP CONSTRAINT x` / `ALTER x DROP DEFAULT` / `ALTER x DROP
 * NOT NULL` all start with the bare token `DROP` — so every shorthand case
 * below is paired with the specific collision it could cause if the
 * disambiguation were wrong, not just the happy path.
 */
describe('scanMigrationFile: COLUMN keyword is optional (Postgres shorthand)', () => {
  it('detects DROP <col> with COLUMN omitted', () => {
    const { findings } = scanMigrationFile('t.sql', `ALTER TABLE "posts" DROP "legacy_slug";`)
    expect(findings).toEqual([
      { kind: 'drop_column', line: 1, table: 'posts', detail: 'legacy_slug' },
    ])
  })

  it('detects DROP IF EXISTS <col> with COLUMN omitted', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" DROP IF EXISTS "legacy_slug";`
    )
    expect(findings).toEqual([
      { kind: 'drop_column', line: 1, table: 'posts', detail: 'legacy_slug' },
    ])
  })

  it('detects ALTER <col> TYPE with COLUMN omitted', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "kb_articles" ALTER "embedding" TYPE vector(1536);`
    )
    expect(findings).toEqual([
      { kind: 'alter_type', line: 1, table: 'kb_articles', detail: 'embedding' },
    ])
  })

  it('detects ALTER <col> SET NOT NULL with COLUMN omitted', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" ALTER "title" SET NOT NULL;`
    )
    expect(findings).toEqual([{ kind: 'set_not_null', line: 1, table: 'posts', detail: 'title' }])
  })

  it('detects ALTER <col> DROP DEFAULT with COLUMN omitted', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "conversations" ALTER "channel" DROP DEFAULT;`
    )
    expect(findings).toEqual([
      { kind: 'drop_default', line: 1, table: 'conversations', detail: 'channel' },
    ])
  })

  it('detects RENAME <col> TO with COLUMN omitted', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" RENAME "old_name" TO "new_name";`
    )
    expect(findings).toEqual([
      { kind: 'rename_column', line: 1, table: 'posts', detail: 'old_name -> new_name' },
    ])
  })

  it('DISAMBIGUATION: shorthand DROP does not swallow DROP CONSTRAINT', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" DROP CONSTRAINT "posts_author_fk";`
    )
    expect(findings).toEqual([
      { kind: 'drop_constraint', line: 1, table: 'posts', detail: 'posts_author_fk' },
    ])
  })

  it('DISAMBIGUATION: shorthand DROP does not misread ALTER <col> DROP DEFAULT as dropping a column named "default"', () => {
    const { findings } = scanMigrationFile('t.sql', `ALTER TABLE "x" ALTER "y" DROP DEFAULT;`)
    expect(findings).toEqual([{ kind: 'drop_default', line: 1, table: 'x', detail: 'y' }])
  })

  it('DISAMBIGUATION: shorthand DROP does not misread ALTER <col> DROP NOT NULL as dropping a column named "not"', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" ALTER "title" DROP NOT NULL;`
    )
    expect(findings).toEqual([])
  })

  it('DISAMBIGUATION: shorthand RENAME does not swallow RENAME CONSTRAINT', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "x" RENAME CONSTRAINT "old_fk" TO "new_fk";`
    )
    expect(findings).toEqual([])
  })

  it('DISAMBIGUATION: shorthand RENAME does not swallow a bare table RENAME TO', () => {
    const { findings } = scanMigrationFile('t.sql', `ALTER TABLE "old_tbl" RENAME TO "new_tbl";`)
    expect(findings).toEqual([
      { kind: 'rename_table', line: 1, table: 'old_tbl', detail: 'old_tbl -> new_tbl' },
    ])
  })

  it('a multi-clause statement mixing shorthand DROP and DROP CONSTRAINT resolves both correctly', () => {
    const { findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" DROP "legacy_slug", DROP CONSTRAINT "posts_author_fk";`
    )
    expect(findings).toEqual([
      { kind: 'drop_column', line: 1, table: 'posts', detail: 'legacy_slug' },
      { kind: 'drop_constraint', line: 1, table: 'posts', detail: 'posts_author_fk' },
    ])
  })
})

describe('scanMigrationFile: @contract annotations', () => {
  it('recognizes a valid annotation', () => {
    const { annotations, malformed } = scanMigrationFile(
      't.sql',
      `-- @contract: safe-after 0.14.0\nALTER TABLE "posts" DROP COLUMN "legacy_slug";`
    )
    expect(annotations).toEqual([{ line: 1, version: '0.14.0' }])
    expect(malformed).toEqual([])
  })

  it('accepts a trailing parenthetical rationale after the version', () => {
    const { annotations } = scanMigrationFile(
      't.sql',
      `-- @contract: safe-after 0.14.0   (column unreferenced since 0.14.0)\nALTER TABLE "posts" DROP COLUMN "x";`
    )
    expect(annotations).toEqual([{ line: 1, version: '0.14.0' }])
  })

  it('flags a @contract line with no safe-after version as malformed, not silently ignored', () => {
    const { annotations, malformed } = scanMigrationFile(
      't.sql',
      `-- @contract: soon\nALTER TABLE "posts" DROP COLUMN "x";`
    )
    expect(annotations).toEqual([])
    expect(malformed).toEqual([{ line: 1, raw: '-- @contract: soon' }])
  })

  it('flags a @contract line with a non-semver version as malformed', () => {
    const { malformed } = scanMigrationFile(
      't.sql',
      `-- @contract: safe-after v14\nALTER TABLE "posts" DROP COLUMN "x";`
    )
    expect(malformed).toEqual([{ line: 1, raw: '-- @contract: safe-after v14' }])
  })

  it('a plain comment that is not a @contract line is neither an annotation nor malformed', () => {
    const { annotations, malformed } = scanMigrationFile(
      't.sql',
      `-- this migration is safe after the next release\nALTER TABLE "posts" DROP COLUMN "x";`
    )
    expect(annotations).toEqual([])
    expect(malformed).toEqual([])
  })

  it('recognizes an annotation trailing real DDL on the same line', () => {
    const { annotations, findings } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" DROP COLUMN "legacy_slug"; -- @contract: safe-after 0.14.0`
    )
    expect(findings).toEqual([
      { kind: 'drop_column', line: 1, table: 'posts', detail: 'legacy_slug' },
    ])
    expect(annotations).toEqual([{ line: 1, version: '0.14.0' }])
  })

  it('a trailing annotation attempt whose version does not parse is malformed, not silently dropped', () => {
    const { annotations, malformed } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "posts" DROP COLUMN "legacy_slug"; -- @contract: soon`
    )
    expect(annotations).toEqual([])
    expect(malformed).toEqual([{ line: 1, raw: '-- @contract: soon' }])
  })

  it('does not mistake @contract-shaped text inside a string literal for a real annotation', () => {
    const { annotations, malformed } = scanMigrationFile(
      't.sql',
      `ALTER TABLE "settings" ALTER COLUMN "notes" SET DEFAULT 'looks like -- @contract: safe-after 1.0.0 but is data';`
    )
    expect(annotations).toEqual([])
    expect(malformed).toEqual([])
  })

  it('rejects safe-after 0.0.0 as malformed rather than a free pass', () => {
    const { annotations, malformed } = scanMigrationFile(
      't.sql',
      `-- @contract: safe-after 0.0.0\nALTER TABLE "posts" DROP COLUMN "x";`
    )
    expect(annotations).toEqual([])
    expect(malformed).toEqual([{ line: 1, raw: '-- @contract: safe-after 0.0.0' }])
  })

  it('accepts a real non-zero version that merely starts with a zero component', () => {
    const { annotations } = scanMigrationFile(
      't.sql',
      `-- @contract: safe-after 0.14.0\nALTER TABLE "posts" DROP COLUMN "x";`
    )
    expect(annotations).toEqual([{ line: 1, version: '0.14.0' }])
  })
})
