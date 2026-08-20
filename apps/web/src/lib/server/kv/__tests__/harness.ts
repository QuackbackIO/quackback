/**
 * Real-Postgres harness for the KV / presence / realtime suites.
 *
 * These substrates replaced Redis, and the properties that matter about them —
 * atomicity under concurrency, TTL semantics, and workspace separation — are
 * properties of *statements executing against a real server*. A fake `db` would
 * let every one of these suites pass while the shipped SQL was wrong, which is
 * exactly the shape this run has caught nineteen times.
 *
 * **Every key is unique per test.** `DATABASE_URL` is hard-coded to one shared
 * `quackback_test` for every worktree and agent on the machine, so a suite that
 * asserted whole-table state would fail on somebody else's row. Nothing here
 * counts rows it did not write.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
// The lint rule reserves @quackback/db/client for db.ts; test fixtures that
// need their own short-lived connection are sanctioned callers, same as
// db-test-fixture.ts and jobs/__tests__/harness.ts.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql, type Database } from '@quackback/db/client'
import {
  createWorkspaceScope,
  runWithWorkspaceScope,
} from '@/lib/server/workspaces/workspace-context'
import {
  makeWorkspaceDescriptor,
  makeWorkspaceSecrets,
} from '@/lib/server/__tests__/workspace-scope'

const URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'

const MIGRATION = path.resolve(
  __dirname,
  '../../../../../../../packages/db/drizzle/0257_pg_kv_presence_realtime.sql'
)

let sqlHandle: postgres.Sql | null = null
let dbHandle: Database | null = null

export function testSql(): postgres.Sql {
  if (!sqlHandle) sqlHandle = postgres(URL, { max: 8, onnotice: () => {} })
  return sqlHandle
}

export function testDb(): Database {
  if (!dbHandle) dbHandle = createDbFromSql(testSql())
  return dbHandle
}

/**
 * Ensure the tables exist, by executing the shipped migration file rather than a
 * paraphrase of it. If the two ever diverge, these suites are testing something
 * that does not ship.
 */
export async function ensureKvSchema(): Promise<void> {
  const sql = testSql()
  const [{ ready }] = await sql<{ ready: boolean }[]>`
    SELECT (
      to_regclass('public.kv_store') IS NOT NULL
      AND to_regclass('public.rate_bucket') IS NOT NULL
      AND to_regclass('public.kv_set_member') IS NOT NULL
      AND to_regclass('public.presence_stream') IS NOT NULL
      AND to_regclass('public.realtime_overflow') IS NOT NULL
    ) AS ready
  `
  if (ready) return
  await sql.unsafe(readFileSync(MIGRATION, 'utf8'))
}

/**
 * Run `fn` with `workspaceKey` as the ambient workspace AND a real database handle in
 * the scope, so `db` inside the code under test reaches Postgres.
 *
 * Deliberately not `__tests__/workspace-scope.ts`'s `withWorkspace`, which stubs the
 * handles: these suites exist to observe what the statements do.
 */
export function withRealWorkspace<T>(workspaceKey: string, fn: () => Promise<T>): Promise<T> {
  return runWithWorkspaceScope(
    createWorkspaceScope({
      workspace: makeWorkspaceDescriptor(workspaceKey),
      db: testDb(),
      sql: testSql() as never,
      secrets: makeWorkspaceSecrets(workspaceKey),
      origin: 'test',
    }),
    fn
  )
}

/** A key nothing else on this machine can collide with. */
export function uniqueKey(prefix: string): string {
  return `${prefix}:${randomUUID()}`
}

/** Two workspace ids for one test, distinct and unique across concurrent runs. */
export function workspacePair(): [string, string] {
  const run = randomUUID().slice(0, 8)
  return [`kvt-a-${run}`, `kvt-b-${run}`]
}

/** Remove everything this test wrote, by workspace id. Never by table. */
export async function cleanupWorkspaces(...workspaceKeys: string[]): Promise<void> {
  const sql = testSql()
  for (const t of workspaceKeys) {
    await sql`DELETE FROM kv_store WHERE workspace_key = ${t}`
    await sql`DELETE FROM rate_bucket WHERE workspace_key = ${t}`
    await sql`DELETE FROM kv_set_member WHERE workspace_key = ${t}`
    await sql`DELETE FROM presence_stream WHERE workspace_key = ${t}`
    await sql`DELETE FROM realtime_overflow WHERE workspace_key = ${t}`
  }
}

export async function closeHarness(): Promise<void> {
  if (sqlHandle) await sqlHandle.end({ timeout: 5 }).catch(() => {})
  sqlHandle = null
  dbHandle = null
}
