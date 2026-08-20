/**
 * Real-Postgres harness for the lease suites.
 *
 * The transactional fixture next door (`__tests__/db-test-fixture.ts`) is the
 * right tool for almost everything and the wrong tool for this: a lease exists
 * precisely so that work can outlive the transaction that claimed it, so a suite
 * that never commits cannot observe the property under test. These suites commit
 * for real and clean up by queue name.
 *
 * **Queue names are unique per test.** `DATABASE_URL` is hard-coded to one
 * shared `quackback_test` for every worktree and agent on the machine, so a
 * suite that asserted whole-table state would fail on somebody else's row. Every
 * assertion here is scoped to a queue name this file minted.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
// The lint rule reserves @quackback/db/client for db.ts; test fixtures that
// need their own short-lived connection are sanctioned callers, same as
// db-test-fixture.ts.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql, type Database } from '@quackback/db/client'

const URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'

const MIGRATION = path.resolve(
  __dirname,
  '../../../../../../../packages/db/drizzle/0253_job_queue.sql'
)

let sqlHandle: postgres.Sql | null = null
let dbHandle: Database | null = null

export function testSql(): postgres.Sql {
  if (!sqlHandle) sqlHandle = postgres(URL, { max: 4, onnotice: () => {} })
  return sqlHandle
}

export function testDb(): Database {
  if (!dbHandle) dbHandle = createDbFromSql(testSql())
  return dbHandle
}

/**
 * Ensure `job_queue` exists, by executing the shipped migration file rather
 * than a paraphrase of it. If the two ever diverge, these suites are testing
 * something that does not ship.
 */
export async function ensureJobQueueSchema(): Promise<void> {
  const sql = testSql()
  const [{ ready }] = await sql<{ ready: boolean }[]>`
    SELECT (
      to_regclass('public.job_queue') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'job_queue_wake_trg')
    ) AS ready
  `
  if (ready) return
  await sql.unsafe(readFileSync(MIGRATION, 'utf8'))
}

let counter = 0
/** A queue name no other test or worktree will touch. */
export function uniqueQueue(label: string): string {
  counter += 1
  return `test-${label}-${process.pid}-${Date.now().toString(36)}-${counter}`
}

export async function cleanupQueues(queues: readonly string[]): Promise<void> {
  if (queues.length === 0) return
  await testSql()`DELETE FROM job_queue WHERE queue = ANY(${[...queues]}::text[])`
}

/**
 * Clean up by dedupe key rather than by queue name.
 *
 * The eight migrated queues have fixed names (`events`, `workflow-dispatch`, …)
 * so a suite exercising one cannot mint a private queue. Deleting the whole
 * queue would delete another checkout's rows out from under it — the shared
 * `quackback_test` rule again — so a suite that has to use the real name
 * removes exactly the keys it wrote.
 */
export async function cleanupDedupeKeys(queue: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  await testSql()`
    DELETE FROM job_queue WHERE queue = ${queue} AND dedupe_key = ANY(${[...keys]}::text[])
  `
}

export async function closeHarness(): Promise<void> {
  const sql = sqlHandle
  sqlHandle = null
  dbHandle = null
  if (sql) await sql.end({ timeout: 5 }).catch(() => {})
}

export interface RowSnapshot {
  id: string
  dedupe_key: string | null
  payload: Record<string, unknown>
  status: string
  attempts: number
  max_attempts: number
  lease_token: string | null
  locked_until: Date | null
  locked_by: string | null
  last_error: string | null
  workspace_key: string | null
  run_at: Date
  finished_at: Date | null
}

export async function rowsFor(queue: string): Promise<RowSnapshot[]> {
  const rows = (await testSql()`
    SELECT id::text, dedupe_key, payload, status, attempts, max_attempts,
           lease_token::text, locked_until, locked_by, last_error, workspace_key,
           run_at, finished_at
    FROM job_queue WHERE queue = ${queue} ORDER BY id
  `) as unknown as Array<Record<string, unknown>>
  // Timestamps arrive as strings or Dates depending on the driver's type
  // parsers; normalise so assertions can compare instants rather than shapes.
  const date = (v: unknown): Date | null =>
    v == null ? null : v instanceof Date ? v : new Date(String(v))
  return rows.map((r) => ({
    ...r,
    locked_until: date(r.locked_until),
    run_at: date(r.run_at) as Date,
    finished_at: date(r.finished_at),
  })) as unknown as RowSnapshot[]
}

/** Force a lease into the past, so the reaper sees it as expired. */
export async function expireLease(queue: string): Promise<void> {
  await testSql()`
    UPDATE job_queue SET locked_until = now() - interval '1 second'
    WHERE queue = ${queue} AND status = 'running'
  `
}
