/**
 * Analytics server functions.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const getAnalyticsData = createServerFn({ method: 'GET' })
  .validator(z.object({ period: z.enum(['7d', '30d', '90d', '12m']) }))
  .handler(async ({ data: { period } }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    const { loadAnalyticsData } = await import('@/lib/server/domains/analytics/analytics-dashboard')
    return loadAnalyticsData(period)
  })
