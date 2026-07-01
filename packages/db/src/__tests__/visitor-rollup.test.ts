import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, and, gte, lt, eq } from 'drizzle-orm'
import { createDb, type Database } from '../client'
import { pageViews, visitorStatsDaily, visitorTopStats } from '../schema/visitor-analytics'
import { refreshVisitorAnalytics } from '../visitor-rollup'

// DB-backed (skips without Postgres). Requires 0137 + today's partitions
// (run `bun run db:migrate` against quackback_test first).
const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
if (DB_URL) db = createDb(DB_URL, { max: 1 })

const NOW = new Date()
const dayStart = new Date(`${NOW.toISOString().slice(0, 10)}T00:00:00.000Z`)
const at = (minutes: number) => new Date(dayStart.getTime() + (10 * 60 + minutes) * 60 * 1000)

async function wipeToday(database: Database): Promise<void> {
  const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  await database
    .delete(pageViews)
    .where(and(gte(pageViews.occurredAt, dayStart), lt(pageViews.occurredAt, nextDay)))
  await database.execute(sql`DELETE FROM visitor_stats_daily`)
  await database.execute(sql`DELETE FROM visitor_top_stats`)
}

beforeAll(async () => {
  if (!db) return
  await wipeToday(db)
  const base = {
    siteOrigin: 'https://feedback.example.com',
    country: 'DE',
    device: 'desktop',
    browser: 'Chrome',
    os: 'Windows',
  }
  await db.insert(pageViews).values([
    // Visitor A on the portal: two views 5min apart (one session), then a
    // third after a 45-minute gap (second session).
    { ...base, surface: 'portal', path: '/a', visitorHash: 'test-a', occurredAt: at(0) },
    { ...base, surface: 'portal', path: '/a', visitorHash: 'test-a', occurredAt: at(5) },
    { ...base, surface: 'portal', path: '/b', visitorHash: 'test-a', occurredAt: at(50) },
    // Visitor B on the widget: a single view.
    {
      ...base,
      surface: 'widget',
      path: '/pricing',
      visitorHash: 'test-b',
      occurredAt: at(2),
      country: 'US',
      device: 'mobile',
      browser: 'Safari',
      os: 'iOS',
    },
  ])
  await refreshVisitorAnalytics(db!, { now: NOW })
})

afterAll(async () => {
  if (db) await wipeToday(db)
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

describe.skipIf(!DB_URL)('refreshVisitorAnalytics', () => {
  it('computes per-surface and all-surface daily stats with 30-minute sessions', async () => {
    const rows = await db!
      .select()
      .from(visitorStatsDaily)
      .where(eq(visitorStatsDaily.date, NOW.toISOString().slice(0, 10)))
    const bySurface = Object.fromEntries(rows.map((r) => [r.surface, r]))

    expect(bySurface['all']).toMatchObject({ uniqueVisitors: 2, pageviews: 4, visits: 3 })
    expect(bySurface['portal']).toMatchObject({ uniqueVisitors: 1, pageviews: 3, visits: 2 })
    expect(bySurface['widget']).toMatchObject({ uniqueVisitors: 1, pageviews: 1, visits: 1 })
  })

  it('is idempotent for the recomputed day', async () => {
    await refreshVisitorAnalytics(db!, { now: NOW })
    const rows = await db!
      .select()
      .from(visitorStatsDaily)
      .where(eq(visitorStatsDaily.date, NOW.toISOString().slice(0, 10)))
    expect(rows).toHaveLength(3)
  })

  it('snapshots ranked top stats per period, surface, and dimension', async () => {
    const rows = await db!.select().from(visitorTopStats).where(eq(visitorTopStats.period, '7d'))

    const allPages = rows.filter((r) => r.surface === 'all' && r.dimension === 'page')
    expect(allPages.map((r) => r.label).sort()).toEqual(['/a', '/b', '/pricing'])
    // Ranked by distinct visitors, ties broken by label for determinism.
    expect(allPages.find((r) => r.rank === 1)?.label).toBe('/a')

    const widgetCountries = rows.filter((r) => r.surface === 'widget' && r.dimension === 'country')
    expect(widgetCountries).toHaveLength(1)
    expect(widgetCountries[0]).toMatchObject({ label: 'US', count: 1, rank: 1 })

    const allBrowsers = rows.filter((r) => r.surface === 'all' && r.dimension === 'browser')
    expect(allBrowsers.map((r) => r.label).sort()).toEqual(['Chrome', 'Safari'])
  })

  it('covers all four preset periods', async () => {
    const rows = await db!.select().from(visitorTopStats)
    const periods = new Set(rows.map((r) => r.period))
    expect([...periods].sort()).toEqual(['12m', '30d', '7d', '90d'])
  })
})
