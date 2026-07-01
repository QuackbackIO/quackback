/**
 * Visitor analytics rollup: recompute recent visitor_stats_daily rows and the
 * visitor_top_stats snapshots from the raw page_views partitions.
 *
 * Called hourly. Recomputes today AND yesterday (UTC) so the final hour
 * before midnight is never lost between runs; historical rows are immutable.
 * Dashboards only ever read the rollup tables, so query cost stays flat no
 * matter how many raw events exist.
 *
 * Uniques note: a visitor's hash differs each day (daily salt), so summing
 * daily uniques over a range equals a distinct count over the raw rows —
 * the rollup-only read path loses nothing.
 */
import { sql } from 'drizzle-orm'
import type { Database } from './client'
import { visitorStatsDaily, visitorTopStats, VISITOR_SURFACES } from './schema/visitor-analytics'

const SESSION_GAP = '30 minutes'
const TOP_N = 10

export const VISITOR_PERIODS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
}

function utcDay(now: Date, offsetDays: number): string {
  const d = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

interface DayStats {
  surface: string
  uniqueVisitors: number
  pageviews: number
  visits: number
}

/**
 * One day's stats for every surface scope in a single pass: per-surface rows
 * via GROUP BY, plus the 'all' scope where sessions collapse across surfaces.
 */
async function computeDayStats(db: Database, date: string): Promise<DayStats[]> {
  const result = await db.execute(sql`
    WITH scoped AS (
      SELECT surface, visitor_hash, occurred_at
      FROM page_views
      WHERE occurred_at >= ${date}::date AND occurred_at < ${date}::date + 1
    ),
    surface_gaps AS (
      SELECT surface,
        CASE WHEN occurred_at - lag(occurred_at) OVER (PARTITION BY surface, visitor_hash ORDER BY occurred_at)
          IS NOT DISTINCT FROM NULL OR occurred_at - lag(occurred_at) OVER (PARTITION BY surface, visitor_hash ORDER BY occurred_at) > interval '${sql.raw(SESSION_GAP)}'
        THEN 1 ELSE 0 END AS is_new
      FROM scoped
    ),
    all_gaps AS (
      SELECT
        CASE WHEN occurred_at - lag(occurred_at) OVER (PARTITION BY visitor_hash ORDER BY occurred_at)
          IS NOT DISTINCT FROM NULL OR occurred_at - lag(occurred_at) OVER (PARTITION BY visitor_hash ORDER BY occurred_at) > interval '${sql.raw(SESSION_GAP)}'
        THEN 1 ELSE 0 END AS is_new
      FROM scoped
    )
    SELECT s.surface AS surface,
      count(DISTINCT s.visitor_hash)::int AS uniques,
      count(*)::int AS pageviews,
      (SELECT coalesce(sum(is_new), 0) FROM surface_gaps g WHERE g.surface = s.surface)::int AS visits
    FROM scoped s
    GROUP BY s.surface
    UNION ALL
    SELECT 'all' AS surface,
      count(DISTINCT visitor_hash)::int AS uniques,
      count(*)::int AS pageviews,
      (SELECT coalesce(sum(is_new), 0) FROM all_gaps)::int AS visits
    FROM scoped
    HAVING count(*) > 0
  `)
  return Array.from(
    result as Iterable<{ surface: string; uniques: number; pageviews: number; visits: number }>
  ).map((r) => ({
    surface: r.surface,
    uniqueVisitors: r.uniques,
    pageviews: r.pageviews,
    visits: r.visits,
  }))
}

interface TopRow {
  dimension: string
  label: string
  visitors: number
}

const DIMENSION_COLUMNS: Record<string, string> = {
  page: 'path',
  source: 'source',
  country: 'country',
  device: 'device',
  browser: 'browser',
  os: 'os',
}

/** Top-N labels per dimension for one (period, surface) scope, visitor-ranked. */
async function computeTopStats(db: Database, fromDate: string, surface: string): Promise<TopRow[]> {
  const surfaceFilter = surface === 'all' ? '' : `AND surface = '${surface}'`
  const blocks = Object.entries(DIMENSION_COLUMNS).map(
    ([dimension, column]) => `(
      SELECT '${dimension}' AS dimension, ${column} AS label, count(DISTINCT visitor_hash)::int AS visitors
      FROM page_views
      WHERE occurred_at >= '${fromDate}'::date AND ${column} IS NOT NULL ${surfaceFilter}
      GROUP BY ${column}
      ORDER BY visitors DESC, label ASC
      LIMIT ${TOP_N}
    )`
  )
  const result = await db.execute(
    sql.raw(
      `SELECT * FROM (${blocks.join(' UNION ALL ')}) t ORDER BY dimension, visitors DESC, label ASC`
    )
  )
  return Array.from(result as Iterable<TopRow>)
}

/** Recompute today + yesterday daily rows and all top-stat snapshots. */
export async function refreshVisitorAnalytics(db: Database, opts?: { now?: Date }): Promise<void> {
  const now = opts?.now ?? new Date()

  for (const offset of [-1, 0]) {
    const date = utcDay(now, offset)
    const stats = await computeDayStats(db, date)
    for (const surface of VISITOR_SURFACES) {
      const row = stats.find((s) => s.surface === surface) ?? {
        surface,
        uniqueVisitors: 0,
        pageviews: 0,
        visits: 0,
      }
      // Days with no traffic still get zero rows only when recomputed (today
      // or yesterday); truly empty historical days simply have no row.
      if (row.pageviews === 0 && offset === -1) continue
      await db
        .insert(visitorStatsDaily)
        .values({ date, surface, ...toCounts(row), computedAt: new Date() })
        .onConflictDoUpdate({
          target: [visitorStatsDaily.date, visitorStatsDaily.surface],
          set: { ...toCounts(row), computedAt: new Date() },
        })
    }
  }

  for (const [period, days] of Object.entries(VISITOR_PERIODS)) {
    const fromDate = utcDay(now, -days)
    const snapshots: (typeof visitorTopStats.$inferInsert)[] = []
    for (const surface of VISITOR_SURFACES) {
      const rows = await computeTopStats(db, fromDate, surface)
      let currentDimension = ''
      let rank = 0
      for (const row of rows) {
        if (row.dimension !== currentDimension) {
          currentDimension = row.dimension
          rank = 0
        }
        rank += 1
        snapshots.push({
          period,
          surface,
          dimension: row.dimension,
          rank,
          label: row.label,
          count: row.visitors,
          computedAt: new Date(),
        })
      }
    }
    await db.transaction(async (tx) => {
      await tx.delete(visitorTopStats).where(sql`period = ${period}`)
      if (snapshots.length > 0) {
        await tx.insert(visitorTopStats).values(snapshots)
      }
    })
  }
}

function toCounts(row: DayStats): {
  uniqueVisitors: number
  pageviews: number
  visits: number
} {
  return { uniqueVisitors: row.uniqueVisitors, pageviews: row.pageviews, visits: row.visits }
}
