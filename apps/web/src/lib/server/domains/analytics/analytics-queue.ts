/**
 * Analytics refresh — an hourly job that refreshes materialized stats.
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`.
 */
import { db, refreshVisitorAnalytics } from '@/lib/server/db'
import { refreshAnalytics } from './analytics.service'

export async function runAnalyticsRefresh(): Promise<void> {
  await refreshAnalytics()
  await refreshVisitorAnalytics(db)
}
