/**
 * Copilot usage + outcome metrics server function, for the "Copilot usage"
 * section of the Quinn performance area (P2-D.2): questions, transforms,
 * summaries, and the actions funnel over a date range. Read-only, gated on
 * analytics.view like the rest of the analytics surface (mirrors
 * assistant-analytics.ts and assistant-tools-analytics.ts).
 */
import { createServerFn } from '@tanstack/react-start'
import { getCopilotUsageMetrics } from '@/lib/server/domains/analytics/copilot-usage'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { dateRangeSchema } from '@/lib/shared/schemas'

export const getCopilotUsageMetricsFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    return getCopilotUsageMetrics(new Date(data.from), new Date(data.to))
  })
