/**
 * Server functions for support reporting (§4.6, §7): SLA attainment + workflow
 * effectiveness over a date range, for the analytics dashboard. Read-only, gated
 * on analytics.view.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  slaAttainment,
  slaAttainmentByPolicy,
  slaBreachHeatmap,
  slaTimeAfterMiss,
} from '@/lib/server/domains/sla/sla-reporting'
import { workflowEffectiveness } from '@/lib/server/domains/workflows/workflow-reporting'
import { attributeValueBreakdown } from '@/lib/server/domains/conversation-attributes/attribute-reporting'
import { dateRangeSchema } from '@/lib/shared/schemas'

export const slaAttainmentFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    return slaAttainment(new Date(data.from), new Date(data.to))
  })

export const slaAttainmentByPolicyFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    return slaAttainmentByPolicy(new Date(data.from), new Date(data.to))
  })

export const slaBreachHeatmapFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    return slaBreachHeatmap(new Date(data.from), new Date(data.to))
  })

export const slaTimeAfterMissFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    return slaTimeAfterMiss(new Date(data.from), new Date(data.to))
  })

export const workflowEffectivenessFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    // workflowId is a plain string over the wire (JSON-safe).
    return (await workflowEffectiveness(new Date(data.from), new Date(data.to))).map((w) => ({
      workflowId: w.workflowId as string,
      started: w.started,
      completed: w.completed,
      interrupted: w.interrupted,
      waiting: w.waiting,
    }))
  })

const attributeBreakdownSchema = dateRangeSchema.extend({
  // Not checked against the live attribute registry here — an unknown/archived
  // key just returns an all-unset breakdown, same as any other reporting read
  // over an absent value.
  key: z.string().trim().min(1).max(100),
})

/** Per-value conversation counts for one custom attribute over a date range
 *  (§C2.7 reporting segmentation). Read-only, gated on analytics.view. */
export const attributeBreakdownFn = createServerFn({ method: 'GET' })
  .validator(attributeBreakdownSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    return attributeValueBreakdown(data.key, new Date(data.from), new Date(data.to))
  })
