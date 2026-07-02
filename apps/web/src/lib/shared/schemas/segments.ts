/**
 * Shared validation schemas for audience segments.
 *
 * Single source of truth for segment rule/condition shapes. Consumed by the
 * admin server functions (functions/admin.ts re-exports these), the REST routes
 * under /api/v1/segments, and the MCP segment tools so the contract never drifts.
 */
import { z } from 'zod'

export const segmentConditionSchema = z.object({
  attribute: z.enum([
    'email',
    'email_verified',
    'created_at_days_ago',
    'post_count',
    'vote_count',
    'comment_count',
    'metadata_key',
    'name',
    'locale',
    'country',
    'last_active_days_ago',
    'signup_source',
    'principal_type',
    'contact_title',
    'contact_metadata_key',
    'organization_domain',
    'organization_external_id',
    'organization_metadata_key',
  ]),
  operator: z.enum([
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'contains',
    'starts_with',
    'ends_with',
    'in',
    'is_set',
    'is_not_set',
  ]),
  // value is optional for presence operators (is_set / is_not_set)
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
    .optional(),
  metadataKey: z.string().optional(),
})

export const segmentRulesSchema = z.object({
  match: z.enum(['all', 'any']),
  conditions: z.array(segmentConditionSchema),
})

const CRON_REGEX =
  /^(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)(\s+(\*|[0-9,\-/]+))?$/

export const evaluationScheduleSchema = z.object({
  enabled: z.boolean(),
  pattern: z.string().min(1).regex(CRON_REGEX, 'Must be a valid cron expression'),
})

export const userAttributeDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'date', 'currency']),
  currencyCode: z
    .enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL'])
    .optional(),
})

export const weightConfigSchema = z.object({
  attribute: userAttributeDefinitionSchema,
  aggregation: z.enum(['sum', 'average', 'count', 'median']),
})

export const createSegmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['manual', 'dynamic']),
  color: z.string().optional(),
  rules: segmentRulesSchema.optional(),
  evaluationSchedule: evaluationScheduleSchema.optional(),
  weightConfig: weightConfigSchema.optional(),
})

/** Full update payload (admin server fn) — identifies the segment by id. */
export const updateSegmentSchema = z.object({
  segmentId: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  color: z.string().optional(),
  rules: segmentRulesSchema.nullable().optional(),
  evaluationSchedule: evaluationScheduleSchema.nullable().optional(),
  weightConfig: weightConfigSchema.nullable().optional(),
})

/** REST update body — the segment is identified by the path param. */
export const updateSegmentBodySchema = updateSegmentSchema.omit({ segmentId: true })

export type CreateSegmentSchemaInput = z.infer<typeof createSegmentSchema>
export type UpdateSegmentBodyInput = z.infer<typeof updateSegmentBodySchema>
