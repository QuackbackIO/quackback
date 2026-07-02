/**
 * Shared validation schemas for widget applications and their per-environment
 * profiles.
 *
 * Single source of truth for the widget-profiles config shape. Consumed by the
 * admin server functions (functions/widget-profiles.ts) and the REST routes
 * under /api/v1/widget-profiles so the contract never drifts.
 */
import { z } from 'zod'

const jsonRecord = z.record(z.string(), z.unknown())

/** Upsert body for a widget application (REST: POST /widget-profiles). */
export const upsertWidgetApplicationSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
})

/**
 * Upsert body for a widget environment profile. The application is identified
 * by the route path param, so `applicationId` is filled in from the path and
 * not part of the request body.
 */
export const upsertWidgetEnvironmentProfileBodySchema = z.object({
  id: z.string().optional(),
  environment: z.string().min(1).max(80),
  displayName: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  allowedOrigins: z.array(z.string().min(1).max(300)).optional(),
  configOverrides: jsonRecord.optional(),
  contentFilters: jsonRecord.optional(),
  supportConfig: jsonRecord.optional(),
})

export type UpsertWidgetApplicationInput = z.infer<typeof upsertWidgetApplicationSchema>
export type UpsertWidgetEnvironmentProfileBodyInput = z.infer<
  typeof upsertWidgetEnvironmentProfileBodySchema
>
