import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'
import {
  ensurePageViewPartitions,
  dropExpiredPageViewPartitions,
  insertPageView,
  isMissingPageViewPartitionError,
} from '../page-view-partitions'

// DB-backed (skips without Postgres, like the 0126 backfill pin). Requires the
// 0137 page_views parent table (run `bun run db:migrate` against quackback_test).
const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
if (DB_URL) db = createDb(DB_URL, { max: 1 })

const OLD_PARTITION = 'page_views_20200101'

async function listPartitions(database: Database): Promise<string[]> {
  const rows = await database.execute(
    sql`SELECT c.relname AS relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'page_views'::regclass`
  )
  return Array.from(rows as Iterable<{ relname: string }>).map((r) => r.relname)
}

afterAll(async () => {
  if (!db) return
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${OLD_PARTITION}"`))
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

describe.skipIf(!DB_URL)('page_views partition maintenance', () => {
  it('ensures a contiguous window ahead and is idempotent', async () => {
    if (!db) return
    await ensurePageViewPartitions(db, { daysAhead: 8 })
    await ensurePageViewPartitions(db, { daysAhead: 8 })

    const expected = await db.execute(
      sql`SELECT 'page_views_' || to_char(current_date + 8, 'YYYYMMDD') AS name`
    )
    const [{ name }] = Array.from(expected as Iterable<{ name: string }>)
    expect(await listPartitions(db)).toContain(name)
  })

  it('drops partitions past retention but keeps recent ones', async () => {
    if (!db) return
    await db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS "${OLD_PARTITION}" PARTITION OF "page_views" FOR VALUES FROM ('2020-01-01') TO ('2020-01-02')`
      )
    )

    const dropped = await dropExpiredPageViewPartitions(db, { retentionDays: 90 })

    expect(dropped).toContain(OLD_PARTITION)
    const remaining = await listPartitions(db)
    expect(remaining).not.toContain(OLD_PARTITION)

    const today = await db.execute(
      sql`SELECT 'page_views_' || to_char(current_date, 'YYYYMMDD') AS name`
    )
    const [{ name: todayName }] = Array.from(today as Iterable<{ name: string }>)
    expect(remaining).toContain(todayName)
  })

  it('ignores unrelated tables when pruning', async () => {
    if (!db) return
    const dropped = await dropExpiredPageViewPartitions(db, { retentionDays: 90 })
    for (const name of dropped) {
      expect(name).toMatch(/^page_views_\d{8}$/)
    }
  })
})

// A day far enough ahead that no maintenance window reaches it, so its
// partition is missing exactly as it is for a workspace whose window ran out.
const FUTURE_DAY = '2099-03-01'
const FUTURE_PARTITION = 'page_views_20990301'

/** Its own pool (several connections, so the race below is a real one) and a statement count. */
const statements: string[] = []
const racingDb: Database | null = DB_URL
  ? createDb(DB_URL, { max: 4, logger: { logQuery: (query) => statements.push(query) } })
  : null

function view(at: string) {
  return {
    occurredAt: new Date(`${at}T12:00:00Z`),
    siteOrigin: 'https://portal.example.test',
    surface: 'portal' as const,
    path: '/partition-repair',
    visitorHash: 'partition-repair-test',
  }
}

async function countStored(database: Database): Promise<number> {
  const rows = await database.execute(
    sql.raw(`SELECT count(*)::int AS n FROM "${FUTURE_PARTITION}"`)
  )
  return Array.from(rows as Iterable<{ n: number }>)[0].n
}

describe.skipIf(!DB_URL)('recording a page view whose day has no partition', () => {
  beforeEach(async () => {
    await racingDb!.execute(sql.raw(`DROP TABLE IF EXISTS "${FUTURE_PARTITION}"`))
    statements.length = 0
  })

  afterAll(async () => {
    if (!racingDb) return
    await racingDb.execute(sql.raw(`DROP TABLE IF EXISTS "${FUTURE_PARTITION}"`))
    // @ts-expect-error optional teardown
    await racingDb.$client?.end?.()
  })

  it('is the error the insert path recognises', async () => {
    const database = racingDb!
    const { pageViews } = await import('../schema/visitor-analytics')
    const error = await database
      .insert(pageViews)
      .values(view(FUTURE_DAY))
      .then(
        () => null,
        (e: unknown) => e
      )
    expect(error).not.toBeNull()
    expect(isMissingPageViewPartitionError(error)).toBe(true)
    expect(isMissingPageViewPartitionError(new Error('some other failure'))).toBe(false)
  })

  it('creates the partition and stores the view', async () => {
    const database = racingDb!
    await insertPageView(database, view(FUTURE_DAY))

    expect(await listPartitions(database)).toContain(FUTURE_PARTITION)
    expect(await countStored(database)).toBe(1)
  })

  it('stores both of two views that race to create the same partition', async () => {
    const database = racingDb!
    for (let round = 0; round < 5; round++) {
      await database.execute(sql.raw(`DROP TABLE IF EXISTS "${FUTURE_PARTITION}"`))
      const results = await Promise.allSettled([
        insertPageView(database, view(FUTURE_DAY)),
        insertPageView(database, view(FUTURE_DAY)),
      ])
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(await countStored(database)).toBe(2)
    }
  })

  it('sends only the insert when the partition already exists', async () => {
    const database = racingDb!
    await insertPageView(database, view(FUTURE_DAY))
    statements.length = 0

    await insertPageView(database, view(FUTURE_DAY))

    expect(statements).toHaveLength(1)
    expect(statements[0]).toMatch(/^insert into "page_views"/)
  })

  it('still throws an insert failure that is not a missing partition', async () => {
    const database = racingDb!
    await insertPageView(database, view(FUTURE_DAY))
    statements.length = 0

    await expect(
      insertPageView(database, { ...view(FUTURE_DAY), visitorHash: null as unknown as string })
    ).rejects.toThrow()
    expect(statements).toHaveLength(1)
  })
})
