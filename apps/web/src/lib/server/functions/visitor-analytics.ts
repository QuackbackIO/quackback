/**
 * Visitor analytics server functions.
 *
 * Reads only the rollup tables (visitor_stats_daily + visitor_top_stats),
 * never the raw page_views partitions, so cost stays flat regardless of
 * traffic. Range uniques are the sum of daily uniques, which is exact here:
 * the visitor hash is salted per day, so no cross-day dedupe exists to lose.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db, and, gte, eq, asc, visitorStatsDaily, visitorTopStats } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { toIsoDateOnly } from '@/lib/shared/utils/date'

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 } as const

export interface MetricTotal {
  current: number
  /** Period-over-period percentage; null when the previous window is empty. */
  delta: number | null
}

type DailyRow = typeof visitorStatsDaily.$inferSelect

function sumMetric(rows: DailyRow[], key: 'uniqueVisitors' | 'pageviews' | 'visits'): number {
  return rows.reduce((acc, row) => acc + row[key], 0)
}

export const getVisitorAnalyticsData = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      period: z.enum(['7d', '30d', '90d', '12m']),
      surface: z.enum(['all', 'portal', 'widget']).optional().default('all'),
    })
  )
  .handler(async ({ data: { period, surface } }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })

    if (!(await isFeatureEnabled('visitorAnalytics'))) {
      return { enabled: false as const }
    }

    const days = PERIOD_DAYS[period]
    const now = new Date()
    const startStr = toIsoDateOnly(new Date(now.getTime() - days * 86_400_000))
    const previousStartStr = toIsoDateOnly(new Date(now.getTime() - 2 * days * 86_400_000))

    const [dailyRows, topRows] = await Promise.all([
      db
        .select()
        .from(visitorStatsDaily)
        .where(
          and(eq(visitorStatsDaily.surface, surface), gte(visitorStatsDaily.date, previousStartStr))
        )
        .orderBy(asc(visitorStatsDaily.date)),
      db
        .select()
        .from(visitorTopStats)
        .where(and(eq(visitorTopStats.period, period), eq(visitorTopStats.surface, surface)))
        .orderBy(asc(visitorTopStats.dimension), asc(visitorTopStats.rank)),
    ])

    const inWindow = dailyRows.filter((r) => r.date >= startStr)
    const previous = dailyRows.filter((r) => r.date < startStr)

    const withDelta = (key: 'uniqueVisitors' | 'pageviews' | 'visits'): MetricTotal => {
      const current = sumMetric(inWindow, key)
      const prev = sumMetric(previous, key)
      return { current, delta: prev > 0 ? Math.round(((current - prev) / prev) * 100) : null }
    }

    const top: Record<string, Array<{ label: string; count: number }>> = {}
    for (const row of topRows) {
      ;(top[row.dimension] ??= []).push({ label: row.label, count: row.count })
    }

    return {
      enabled: true as const,
      uniqueVisitors: withDelta('uniqueVisitors'),
      pageviews: withDelta('pageviews'),
      visits: withDelta('visits'),
      dailyStats: inWindow.map((r) => ({
        date: r.date,
        uniqueVisitors: r.uniqueVisitors,
        pageviews: r.pageviews,
        visits: r.visits,
      })),
      top,
      computedAt: dailyRows.at(-1)?.computedAt?.toISOString() ?? null,
    }
  })

export type VisitorAnalyticsData = Awaited<ReturnType<typeof getVisitorAnalyticsData>>
