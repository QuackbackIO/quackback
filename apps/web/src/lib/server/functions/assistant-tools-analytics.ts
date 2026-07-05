/**
 * Tools & connectors metrics server functions, for the "Tools and
 * connectors" section of the Quinn performance area: per-tool action counts
 * and connector health. Both read-only; gated on analytics.view like the
 * rest of the analytics surface (mirrors assistant-analytics.ts) rather than
 * connector.manage — this is reporting (can I see whether Quinn's tools are
 * healthy?), not connector configuration, which stays behind
 * connector.manage in functions/data-connectors.ts.
 */
import { createServerFn } from '@tanstack/react-start'
import { getQuinnToolMetrics, getConnectorHealth } from '@/lib/server/domains/analytics/quinn-tools'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { dateRangeSchema } from '@/lib/shared/schemas'

export const getQuinnToolMetricsFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    return getQuinnToolMetrics(new Date(data.from), new Date(data.to))
  })

export const getConnectorHealthFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
  return getConnectorHealth()
})
