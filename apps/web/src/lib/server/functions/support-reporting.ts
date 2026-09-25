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

/**
 * The support card's figures for one date range: SLA attainment (overall, per
 * policy, breach heatmap, time after a miss) and workflow effectiveness, read
 * together so the card costs one request and one session resolution.
 */
export const supportReportingFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    const from = new Date(data.from)
    const to = new Date(data.to)
    const [sla, slaByPolicy, slaHeatmap, slaTimeAfterMissResult, workflows] = await Promise.all([
      slaAttainment(from, to),
      slaAttainmentByPolicy(from, to),
      slaBreachHeatmap(from, to),
      slaTimeAfterMiss(from, to),
      workflowEffectiveness(from, to),
    ])
    return {
      sla,
      slaByPolicy,
      slaHeatmap,
      slaTimeAfterMiss: slaTimeAfterMissResult,
      // workflowId is a plain string over the wire (JSON-safe).
      workflows: workflows.map((w) => ({
        workflowId: w.workflowId as string,
        started: w.started,
        completed: w.completed,
        interrupted: w.interrupted,
        waiting: w.waiting,
      })),
    }
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
