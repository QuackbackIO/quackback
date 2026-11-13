/**
 * Shared pieces for the backfill suites: a sample backfill over `tickets`, the
 * check every registered backfill must pass, and cleanup by name.
 *
 * Real Postgres and real commits: a backfill walks in its own short
 * transactions, so a suite that never committed could not see a batch land.
 * Every name is unique per test, so nothing here touches another suite's rows.
 */
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { tickets } from '@quackback/db/schema'
import { testDb, testSql } from '@/lib/server/jobs/__tests__/harness'
import {
  backfillKeys,
  followUpKeys,
  walkBackfill,
  walkFollowUp,
  type BackfillDb,
  type BackfillWalk,
  type BatchedBackfill,
} from '../batched'

export { testDb, testSql }

const URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'

let counter = 0
/** A backfill name no other test or worktree will use. */
export function uniqueName(label: string): string {
  counter += 1
  return `t-${label}-${process.pid}-${Date.now().toString(36)}-${counter}`
}

/** Remove every kv row and job row a backfill of this name wrote. */
export async function cleanupBackfill(name: string): Promise<void> {
  const keys = [...Object.values(backfillKeys(name)), ...Object.values(followUpKeys(name))]
  await testSql()`DELETE FROM kv_store WHERE key = ANY(${keys}::text[])`
  await testSql()`DELETE FROM job_queue WHERE dedupe_key LIKE ${`%:${name}:%`}`
  await testSql()`DELETE FROM tickets WHERE title LIKE ${`${name}%`}`
}

/** A connection of its own, for reading what another session has committed. */
export async function withOtherConnection<T>(body: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const other = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    return await body(other)
  } finally {
    await other.end({ timeout: 5 }).catch(() => {})
  }
}

/** Seed `count` tickets whose titles start with `marker`, last edited at `updatedAt`. */
export async function seedTickets(
  db: BackfillDb,
  marker: string,
  count: number,
  updatedAt: Date
): Promise<void> {
  const rows = (await db.execute(
    sql`SELECT id FROM ticket_statuses WHERE deleted_at IS NULL ORDER BY position LIMIT 1`
  )) as unknown as Array<{ id: string }>
  const statusId = rows[0].id
  for (let i = 0; i < count; i++) {
    await db.execute(sql`
      INSERT INTO tickets (id, title, status_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${`${marker}-${i}`}, ${statusId}::uuid,
              ${updatedAt.toISOString()}, ${updatedAt.toISOString()})
    `)
  }
}

/**
 * A table of the walk's own, shaped like the part of `tickets` the sample uses,
 * so a suite can reason about batch boundaries without other suites' rows.
 */
export async function createScratchTable(name: string): Promise<void> {
  await testSql().unsafe(`
    CREATE TABLE ${name} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      custom_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

/** How often the walk stepped each marked row (by title), read from `custom_attributes[flag]`. */
export async function flagCounts(marker: string, flag: string, table = 'tickets'): Promise<number[]> {
  const rows = await testSql().unsafe<{ n: number | null }[]>(
    `SELECT (custom_attributes ->> $1)::int AS n FROM ${table} WHERE title LIKE $2 ORDER BY title`,
    [flag, `${marker}-%`]
  )
  return rows.map((r) => r.n ?? 0)
}

/**
 * A walk that counts, in `custom_attributes[flag]`, how often it stepped each
 * row titled `<marker>-<n>`. On `tickets` it is a Drizzle update that keeps
 * `updated_at` as the rule asks (unless `keepUpdatedAt` is false); on a scratch
 * table it is raw SQL. `onStep` runs before each batch, so a test can fail or
 * observe one.
 */
export function sampleWalk(opts: {
  marker: string
  flag: string
  table?: string
  batchSize?: number
  rows?: number
  keepUpdatedAt?: boolean
  changesNothing?: boolean
  onStep?: (batch: number) => Promise<void> | void
}): BackfillWalk {
  let batch = 0
  const rows = opts.rows ?? 5
  const table = opts.table ?? 'tickets'
  const like = `${opts.marker}-%`
  return {
    table,
    batchSize: opts.batchSize ?? 2,
    step: async (tx, { fromId, toId }) => {
      batch += 1
      await opts.onStep?.(batch)
      if (opts.changesNothing) return
      if (table !== 'tickets') {
        await tx.execute(sql`
          UPDATE ${sql.identifier(table)}
          SET custom_attributes = custom_attributes
            || jsonb_build_object(${opts.flag}::text, coalesce((custom_attributes ->> ${opts.flag}::text)::int, 0) + 1)
          WHERE id <= ${toId}::uuid AND (${fromId}::uuid IS NULL OR id > ${fromId}::uuid)
            AND title LIKE ${like}
        `)
        return
      }
      const keep = opts.keepUpdatedAt === false ? {} : { updatedAt: sql`${tickets.updatedAt}` }
      await tx
        .update(tickets)
        .set({
          customAttributes: sql`${tickets.customAttributes} || jsonb_build_object(${opts.flag}::text, coalesce((${tickets.customAttributes} ->> ${opts.flag}::text)::int, 0) + 1)`,
          ...keep,
        })
        .where(
          sql`${tickets.id} <= ${toId}::uuid
            AND (${fromId}::uuid IS NULL OR ${tickets.id} > ${fromId}::uuid)
            AND ${tickets.title} LIKE ${like}`
        )
    },
    fixture: async (db, { ticketUpdatedAt }) => {
      if (table === 'tickets') await seedTickets(db, opts.marker, rows, ticketUpdatedAt)
      else {
        for (let i = 0; i < rows; i++) {
          await db.execute(sql`
            INSERT INTO ${sql.identifier(table)} (title, updated_at)
            VALUES (${`${opts.marker}-${i}`}, ${ticketUpdatedAt.toISOString()})
          `)
        }
      }
      return async (check) => {
        const counted = (await check.execute(sql`
          SELECT count(*)::int AS n FROM ${sql.identifier(table)}
          WHERE title LIKE ${like} AND (custom_attributes ->> ${opts.flag}::text) IS NOT NULL
        `)) as unknown as Array<{ n: number }>
        return counted[0].n === rows
      }
    },
  }
}

/** The marker a sample backfill's follow-up seeds its own rows under. */
export function followUpMarker(name: string): string {
  return `${name}.f`
}

/**
 * A sample backfill with a sample follow-up. Each seeds its own rows, so each
 * `verify` reads only what its own walk changed.
 */
export function sampleBackfill(
  name: string,
  opts: {
    requiresMigration: string
    table?: string
    walk?: Partial<Parameters<typeof sampleWalk>[0]>
    followUp?: Partial<Parameters<typeof sampleWalk>[0]> | false
    delayMs?: number
  }
): BatchedBackfill {
  return {
    name,
    requiresMigration: opts.requiresMigration,
    ...sampleWalk({ marker: name, flag: 'walked', table: opts.table, ...opts.walk }),
    followUp:
      opts.followUp === false
        ? undefined
        : {
            queue: 'ticket-frt-reconcile',
            delayMs: opts.delayMs ?? 60 * 60_000,
            ...sampleWalk({
              marker: followUpMarker(name),
              flag: 'reconciled',
              table: opts.table,
              ...opts.followUp,
            }),
          },
  }
}

/**
 * The check every registered backfill and follow-up must pass.
 *
 * Each walk seeds its fixture with tickets last edited a year ago, runs, and
 * then must pass its own `verify` (so a step that changes nothing fails) and
 * must have left every seeded ticket's `updated_at` exactly as it was (so a
 * backfill cannot make old tickets look new). Returns the problems found.
 */
export async function checkBackfill(entry: BatchedBackfill): Promise<string[]> {
  const problems: string[] = []
  const walks: Array<[string, BackfillWalk | undefined, () => Promise<void>]> = [
    [entry.name, entry, () => walkBackfill(entry)],
    [`${entry.name} follow-up`, entry.followUp, () => walkFollowUp(entry)],
  ]
  for (const [label, walk, run] of walks) {
    if (!walk) continue
    if (typeof walk.fixture !== 'function') {
      problems.push(`${label} has no fixture`)
      continue
    }
    // A year ago, to the millisecond, and unique to this walk.
    const seededAt = new Date(Date.now() - 365 * 86_400_000 - Math.floor(Math.random() * 1e6))
    const verify = await walk.fixture(testDb(), { ticketUpdatedAt: seededAt })
    if (typeof verify !== 'function') {
      problems.push(`${label} fixture returns no verify`)
      continue
    }
    const seeded = await testSql()<{ id: string }[]>`
      SELECT id::text FROM tickets WHERE updated_at = ${seededAt.toISOString()}
    `
    await run()
    if (!(await verify(testDb()))) problems.push(`${label} did not pass its verify`)
    const moved = await testSql()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM tickets
      WHERE id = ANY(${seeded.map((r) => r.id)}::uuid[])
        AND updated_at <> ${seededAt.toISOString()}
    `
    if (moved[0].n > 0) problems.push(`${label} changed updated_at on ${moved[0].n} ticket(s)`)
  }
  return problems
}
