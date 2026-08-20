import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * No schema change may be issued on `testDb`.
 *
 * `testDb` is the db-test fixture's long-lived transaction: it opens in
 * `beforeEach` and rolls back in `afterEach`, so it spans the whole test. A
 * `ALTER TABLE` on it takes ACCESS EXCLUSIVE on a table every other suite is
 * reading and writing, and holds it for that entire span. Postgres takes the
 * lock even when the statement turns out to be a no-op, so
 * `ADD COLUMN IF NOT EXISTS` against a column that already exists is just as
 * blocking as a real change.
 *
 * Two suites doing that concurrently deadlock: each holds row locks on the
 * table the other is waiting to lock exclusively. That was measured at roughly
 * one run in three, on suites that decide whether a signup policy lets somebody
 * in — so the instrument every other verification leans on was the flakiest
 * thing in the tree.
 *
 * The rule is deliberately about the HANDLE rather than about the statement. A
 * suite that needs its own schema builds one on its own connection
 * (`cloud-concurrency.db.test.ts` copies a table into a private schema,
 * `lineage-double-apply.db.test.ts` migrates a scratch database), and neither
 * blocks anybody. What is banned is reshaping a SHARED table from inside the
 * shared transaction.
 *
 * The alternative to DDL is a probe: `createDbTestFixture({ probe })` runs
 * before any transaction is open, so asking there for a column a migration
 * ships either finds a migrated database or skips the suite.
 *
 * Deterministic, unlike the deadlock itself — a reinstated `ALTER TABLE` fails
 * this test on every run rather than one in three.
 */
const DDL = /\b(?:ALTER|CREATE|DROP|TRUNCATE)\s+(?:TABLE|INDEX|TYPE|SCHEMA|VIEW)\b/i

/** `testDb.execute(...)` / `testDb.transaction(...)` up to the closing paren of the call. */
const TEST_DB_CALL = /testDb\s*\.\s*(?:execute|transaction)\s*\(([\s\S]*?)\)\s*(?:\n|$)/g

function testFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...testFiles(full))
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('db test fixture', () => {
  it('never issues DDL on the shared transaction', () => {
    const offenders: string[] = []
    // Anchored to this file, not to `process.cwd()`: the suite is run both from
    // `apps/web` and from the repo root, and the cwd-relative form silently
    // scanned a directory that does not exist in the second case.
    for (const file of testFiles(join(__dirname, '../../..'))) {
      // This file carries the banned statement on purpose, as the control below.
      if (file.endsWith('db-fixture-no-ddl.test.ts')) continue
      const source = readFileSync(file, 'utf8')
      if (!source.includes('testDb')) continue
      for (const match of source.matchAll(TEST_DB_CALL)) {
        if (DDL.test(match[1] ?? '')) {
          offenders.push(`${file.replace(process.cwd(), '.')}: ${match[0].trim().slice(0, 90)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // The control: the pattern above really does recognise the statement that
  // caused this, so an empty result means "none present" rather than "the
  // matcher never matches anything".
  it('recognises the statement it bans', () => {
    const sample =
      'await testDb.execute(sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS x text`)\n'
    const found = [...sample.matchAll(TEST_DB_CALL)].filter((m) => DDL.test(m[1] ?? ''))
    expect(found).toHaveLength(1)
  })
})
