/**
 * Transactional test-DB fixture: real Postgres, zero persistence. Every test
 * runs inside a transaction that is ALWAYS rolled back (begin in beforeEach,
 * sentinel-throw rollback in afterEach). Usage, the importOriginal-spread
 * rebind of the global `db`, and the policy on when to mock instead all live
 * in README.md next to this file.
 *
 * Mechanics unique to this file:
 * - The transaction callback parks on a hold promise so one transaction
 *   spans the whole test; rollback releases it and the sentinel throw makes
 *   ROLLBACK the only exit, even on test failure.
 * - `testDb` is a proxy onto the live transaction handle, shaped like the
 *   global `db`. Code under test calling `db.transaction(...)` gets a
 *   savepoint inside the fixture's transaction, so even a committed inner
 *   transaction vanishes at rollback.
 * - The module-level transaction slot is file-scoped (vitest isolates module
 *   registries per file); each file opens its own connection, and tests
 *   within a file must run sequentially (no `it.concurrent`).
 */
import { sql } from 'drizzle-orm'
// Direct client import to spin up our own pool — bypasses the global `db`
// proxy/singleton so each test file keeps its own short-lived connection
// (and closes it cleanly in afterAll). The lint rule reserves
// @quackback/db/client for the canonical db.ts entry; this fixture is a
// sanctioned caller of `createDb`, like board-view-filter-parity.test.ts.
// eslint-disable-next-line no-restricted-imports
import { createDb, type Database } from '@quackback/db/client'

/** The transaction handle type the fixture parks each test inside. */
export type TestTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

/** Thrown into the transaction callback so postgres always rolls back; compared by identity. */
const ROLLBACK = new Error('db-test-fixture: intentional rollback')

let created = false
let activeDb: Database | null = null
let activeTx: TestTransaction | null = null
let releaseHold: (() => void) | null = null
let txSettled: Promise<void> | null = null

/**
 * The current test's transaction, shaped like the global `db` so it can be
 * dropped in via the importOriginal-spread mock. Property access forwards to
 * the live transaction; using it outside begin()/rollback() throws.
 */
export const testDb: Database = new Proxy({} as Database, {
  get(_, prop) {
    if (!activeTx) {
      throw new Error(
        'db-test-fixture: no active test transaction. Call fixture.begin() in beforeEach ' +
          'and guard the suite with describe.skipIf(!fixture.available).'
      )
    }
    const value = (activeTx as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(activeTx)
      : value
  },
})

export interface DbTestFixtureOptions {
  /**
   * Schema-currency probe, run against each candidate DB before it is
   * accepted. Select the columns your suite depends on (`limit(0)` is
   * enough); a stale or missing schema then skips the suite instead of
   * failing it mid-test.
   */
  probe?: (db: Database) => Promise<void>
}

export interface DbTestFixture {
  /** False when no candidate DB is reachable/current; use describe.skipIf. */
  available: boolean
  /** Open the per-test transaction. Call from beforeEach. */
  begin: () => Promise<void>
  /** Roll the transaction back. Call from afterEach; safe to call when begin failed. */
  rollback: () => Promise<void>
  /** Release the connection. Call from afterAll. */
  close: () => Promise<void>
}

async function endClient(db: Database): Promise<void> {
  // postgres-js attaches its raw client at $client; closing it releases the
  // pool so vitest doesn't hang on exit.
  const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
  await raw?.end?.()
}

/**
 * Create the file's fixture. Await at module top level so
 * `describe.skipIf(!fixture.available)` sees a definite boolean.
 */
export async function createDbTestFixture(
  options: DbTestFixtureOptions = {}
): Promise<DbTestFixture> {
  if (created) {
    throw new Error('db-test-fixture: one fixture per test file (testDb is module-global)')
  }
  created = true

  for (const url of CANDIDATE_URLS) {
    const candidate = createDb(url, { max: 1, prepare: false })
    try {
      await candidate.execute(sql`select 1`)
      await options.probe?.(candidate)
      activeDb = candidate
      break
    } catch {
      await endClient(candidate).catch(() => {})
    }
  }

  const begin = async (): Promise<void> => {
    const db = activeDb
    if (!db) {
      throw new Error(
        'db-test-fixture: no reachable test database — guard the suite with describe.skipIf(!fixture.available)'
      )
    }
    if (activeTx || txSettled) {
      throw new Error('db-test-fixture: begin() called before the previous rollback()')
    }

    let ready!: (tx: TestTransaction) => void
    let failed!: (err: unknown) => void
    const txReady = new Promise<TestTransaction>((resolve, reject) => {
      ready = resolve
      failed = reject
    })
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve
    })

    // The callback parks on `hold` so the transaction spans the whole test,
    // then throws the sentinel — rollback is the only way out.
    txSettled = db
      .transaction(async (tx) => {
        ready(tx)
        await hold
        throw ROLLBACK
      })
      .catch((err) => {
        if (err !== ROLLBACK) throw err
      })
    // BEGIN itself can fail before the callback runs (dead connection);
    // surface that as a begin() failure instead of hanging on txReady.
    txSettled.catch(failed)

    activeTx = await txReady
  }

  const rollback = async (): Promise<void> => {
    activeTx = null
    releaseHold?.()
    releaseHold = null
    const settled = txSettled
    txSettled = null
    // Surfaces any transaction-machinery error not already thrown in-test.
    if (settled) await settled
  }

  const close = async (): Promise<void> => {
    if (txSettled) await rollback()
    const db = activeDb
    activeDb = null
    if (db) await endClient(db)
  }

  return { available: activeDb !== null, begin, rollback, close }
}
