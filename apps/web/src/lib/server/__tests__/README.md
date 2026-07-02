# Mocking the db in server tests

Two sanctioned patterns. Hand-rolled per-table db stubs in individual test
files (a fake `@/lib/server/db` that re-lists every table) are banned: every
new table breaks them, and 23 files were on that treadmill before this policy.

## 1. Real-DB transactional fixture

For flows that touch multiple tables or whose value is that the SQL actually
runs against the live schema: merge/registry sweeps, FK and unique-constraint
semantics, raw-SQL fragments. Use `db-test-fixture.ts`. Each test runs in a
transaction that is always rolled back, so the test DB stays clean; code under
test that calls `db.transaction(...)` gets a savepoint inside it.

```ts
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { posts } from '@/lib/server/db'

// Domain code imports the global `db`; rebind it to the test transaction.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const fixture = await createDbTestFixture({
  // Probe the columns you seed; a stale schema skips the suite, never fails it.
  probe: async (db) => void (await db.select({ id: posts.id }).from(posts).limit(0)),
})

describe.skipIf(!fixture.available)('my flow', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('moves rows', async () => {
    await testDb.insert(posts).values({
      /* seed inside the transaction */
    })
    await realDomainFunction() // runs inside the same transaction via the mock
  })
})
```

Setup: the test DB must be migrated. CI already runs `bun run db:migrate`
against `quackback_test`; locally, after adding migrations run
`DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_test bun run db:migrate`.
Availability/skip semantics follow `policy/__tests__/board-view-filter-parity.test.ts`
(probe `DATABASE_URL`, fall back to the dev DB, skip when neither works — safe
because every write rolls back). One fixture per file; no `it.concurrent`.

## 2. importOriginal-spread mock

For pure logic, error paths, and call-shape/ordering seams. Spread the real
module and override only `db` — never re-list tables:

```ts
const mockInsert = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { insert: (...args: unknown[]) => mockInsert(...args) },
}))
```

The principal-merge suites share one such harness with an operations log:
`principal-merge-db-mock.ts`.

Rule of thumb: if the test's value depends on Postgres accepting the SQL or
enforcing a constraint, use the fixture. If it is about sequencing, branching,
or error handling, use the spread mock.
