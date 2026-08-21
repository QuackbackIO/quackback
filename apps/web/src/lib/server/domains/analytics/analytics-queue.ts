/**
 * Analytics refresh — an hourly job that refreshes materialized stats.
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`.
 */
import { db, refreshVisitorAnalytics } from '@/lib/server/db'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { refreshAnalytics } from './analytics.service'

export async function runAnalyticsRefresh(): Promise<void> {
  await refreshAnalytics()
  if (await isFeatureEnabled('visitorAnalytics')) {
    await refreshVisitorAnalytics(db)
  }
}
