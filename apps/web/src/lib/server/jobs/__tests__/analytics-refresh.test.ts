/**
 * The hourly `analytics` job (JOB-34) refreshes both rollups: the feedback
 * daily stats (whose test-data exclusion is proven against Postgres in
 * __tests__/test-ingress.db.test.ts) and the visitor analytics
 * (packages/db visitor-rollup.test.ts). This pins that the job runs both, on
 * the workspace database, and that a failing feedback refresh fails the job
 * so the queue retries it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refreshAnalytics: vi.fn(),
  refreshVisitorAnalytics: vi.fn(),
  db: { marker: 'workspace-db' },
}))

vi.mock('@/lib/server/domains/analytics/analytics.service', () => ({
  refreshAnalytics: mocks.refreshAnalytics,
}))
vi.mock('@/lib/server/db', () => ({
  db: mocks.db,
  refreshVisitorAnalytics: mocks.refreshVisitorAnalytics,
}))

import { JOB_DEFINITIONS } from '../definitions'
import { runAnalyticsRefresh } from '@/lib/server/domains/analytics/analytics-queue'

beforeEach(() => {
  mocks.refreshAnalytics.mockReset().mockResolvedValue(undefined)
  mocks.refreshVisitorAnalytics.mockReset().mockResolvedValue(undefined)
})

describe('the hourly analytics refresh', () => {
  it('is scheduled every hour', () => {
    const def = JOB_DEFINITIONS.find((d) => d.name === 'analytics')
    expect(def?.cron).toBe('0 * * * *')
  })

  it('refreshes the feedback stats, then the visitor analytics on the workspace database', async () => {
    const order: string[] = []
    mocks.refreshAnalytics.mockImplementation(async () => order.push('feedback'))
    mocks.refreshVisitorAnalytics.mockImplementation(async () => order.push('visitors'))
    await runAnalyticsRefresh()
    expect(order).toEqual(['feedback', 'visitors'])
    expect(mocks.refreshVisitorAnalytics).toHaveBeenCalledWith(mocks.db)
  })

  it('fails the job when the feedback refresh fails, so the queue retries it', async () => {
    mocks.refreshAnalytics.mockRejectedValue(new Error('lock timeout'))
    await expect(runAnalyticsRefresh()).rejects.toThrow('lock timeout')
    expect(mocks.refreshVisitorAnalytics).not.toHaveBeenCalled()
  })
})
