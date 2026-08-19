/** Action metrics server function for the Quinn performance area. */
import { createServerFn } from '@tanstack/react-start'
import { getQuinnToolMetrics } from '@/lib/server/domains/analytics/quinn-tools'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { dateRangeSchema } from '@/lib/shared/schemas'

export const getQuinnToolMetricsFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    return getQuinnToolMetrics(new Date(data.from), new Date(data.to))
  })
